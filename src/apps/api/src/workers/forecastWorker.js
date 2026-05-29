import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import { pool } from "../db.js";
import { buildBaselineForecast } from "../forecasting/baselineForecast.js";
import { buildPartsDemandForecast, buildServiceOrderForecast, buildSlaBreachRiskForecast, buildWarrantyReturnsForecast } from "../forecasting/domainForecasts.js";
import { DomainForecastData, DomainForecastRollup, ForecastData, ForecastEventCalendar, ForecastRun } from "../data/models/index.js";
import { ForecastCacheService } from "../services/forecastCacheService.js";
import { ForecastBiasService } from "../services/forecastBiasService.js";

dotenv.config();

const FORECAST_TYPE = "baseline";
const SALES_DOMAIN = "Sales";
const PARTS_DOMAIN = "Parts";
const SERVICE_DOMAIN = "Service";
const WARRANTY_DOMAIN = "Warranty";
const SLA_DOMAIN = "SLA";
const PARTS_FORECAST_TYPE = "demand";
const SERVICE_FORECAST_TYPE = "order_volume";
const WARRANTY_FORECAST_TYPE = "warranty_returns";
const SLA_FORECAST_TYPE = "sla_breach_risk";
const DEFAULT_HORIZON = 6;
const MAX_BATCH_SIZE = 2500;
const CALIBRATION_TOLERANCE_PERCENTAGE_POINTS = 2;
const workerLockId = 46013520;
const domainWorkerLockIds = {
  [PARTS_DOMAIN]: 46013521,
  [SERVICE_DOMAIN]: 46013522,
  [WARRANTY_DOMAIN]: 46013523,
  [SLA_DOMAIN]: 46013524
};
const currentFile = fileURLToPath(import.meta.url);

function domainDataKey(domain) {
  return String(domain || "").toLowerCase();
}

/**
 * Builds a stable forecast key used to compare current rows against a rerun result set.
 */
function buildForecastKey({
  forecastType,
  level,
  groupId,
  segment,
  modelId,
  variantId,
  forecastMonth
}) {
  return [
    forecastType,
    level,
    groupId,
    segment ?? "",
    modelId ?? "",
    variantId ?? "",
    forecastMonth
  ].join("|");
}

function getMonthRange(month) {
  const start = new Date(`${month}T00:00:00.000Z`);
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + 1);
  end.setUTCDate(0);

  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10)
  };
}

function matchesScopeValue(eventScopeValue, dealerScopeValue) {
  // Scope values are entered by users, so match them case-insensitively against
  // canonical dealer metadata from the database.
  return String(eventScopeValue || "").trim().toLowerCase() === String(dealerScopeValue || "").trim().toLowerCase();
}

/**
 * Returns the active event rules that apply to the provided forecast point and dealer scope.
 */
function findMatchingEvents(point, dealer, eventCalendar) {
  const monthRange = getMonthRange(point.month);

  return eventCalendar.filter((event) => {
    const overlapsForecastMonth = event.start_date <= monthRange.end && event.end_date >= monthRange.start;
    if (!overlapsForecastMonth) {
      return false;
    }

    const scope = String(event.scope || "").toLowerCase();

    if (scope === "national") {
      return true;
    }

    if (scope === "zone") {
      return matchesScopeValue(event.scope_value, dealer.zone);
    }

    if (scope === "state") {
      return matchesScopeValue(event.scope_value, dealer.state);
    }

    if (scope === "service center") {
      return matchesScopeValue(event.scope_value, dealer.serviceCenterId);
    }

    return false;
  });
}

/**
 * Applies the configured event uplift to a single forecast point.
 */
function applyPointUplift(point, dealer, eventCalendar) {
  const matchingEvents = findMatchingEvents(point, dealer, eventCalendar);
  const totalUpliftPct = matchingEvents.reduce((sum, event) => sum + Number(event.uplift_pct), 0);
  const upliftFactor = 1 + totalUpliftPct / 100;
  const upliftedUnitsSold = Math.max(0, Math.round(point.unitsSold * upliftFactor));

  return {
    ...point,
    unitsSold: upliftedUnitsSold,
    lower80: Math.max(0, Math.round((point.lower80 ?? point.unitsSold) * upliftFactor)),
    upper80: Math.max(0, Math.round((point.upper80 ?? point.unitsSold) * upliftFactor)),
    lower95: Math.max(0, Math.round((point.lower95 ?? point.unitsSold) * upliftFactor)),
    upper95: Math.max(0, Math.round((point.upper95 ?? point.unitsSold) * upliftFactor))
  };
}

function summarizeDataQuality(values) {
  const uniqueValues = [...new Set(values.filter(Boolean))];

  if (uniqueValues.length === 0) {
    return "rich";
  }

  if (uniqueValues.length === 1) {
    return uniqueValues[0];
  }

  return "sparse";
}

function roundCorrection(value) {
  if (!Number.isFinite(value) || value <= 0) {
    return 1;
  }

  return Number(value.toFixed(6));
}

function roundUnits(value) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.round(value));
}

function summarizeBiasCorrection(points) {
  const totalUnits = points.reduce((sum, point) => sum + point.unitsSold, 0);

  if (totalUnits > 0) {
    return roundCorrection(
      points.reduce((sum, point) => sum + (point.biasCorrection ?? 1) * point.unitsSold, 0) / totalUnits
    );
  }

  if (points.length === 0) {
    return 1;
  }

  return roundCorrection(points.reduce((sum, point) => sum + (point.biasCorrection ?? 1), 0) / points.length);
}

/**
 * Applies event uplift rules to dealer-level forecast series.
 */
function applyEventUpliftsToDealerSeries(dealerSeries, eventCalendar) {
  if (eventCalendar.length === 0) {
    return dealerSeries;
  }

  return dealerSeries.map((series) => ({
    ...series,
    method: `${series.method} + event-uplift`,
    forecast: series.forecast.map((point) => applyPointUplift(point, series, eventCalendar))
  }));
}

function applyDomainPointUplift(point, series, eventCalendar) {
  const matchingEvents = findMatchingEvents(point, series, eventCalendar);
  const totalUpliftPct = matchingEvents.reduce((sum, event) => sum + Number(event.uplift_pct), 0);
  const upliftFactor = 1 + totalUpliftPct / 100;
  const upliftedUnits = Math.max(0, Math.round(point.units * upliftFactor));
  const upliftedRiskScore = Number.isFinite(Number(point.riskScore))
    ? Math.min(100, Number(point.riskScore) * upliftFactor)
    : null;

  return {
    ...point,
    units: upliftedUnits,
    expectedBreaches: point.expectedBreaches === undefined ? undefined : upliftedUnits,
    breachProbability: point.breachProbability === undefined ? undefined : Number(Math.min(1, upliftedUnits / 100).toFixed(4)),
    riskScore: upliftedRiskScore === null ? point.riskScore : Number(upliftedRiskScore.toFixed(2)),
    riskLevel: upliftedRiskScore === null ? point.riskLevel : riskLevelFromScore(upliftedRiskScore),
    lower80: Math.max(0, Math.round((point.lower80 ?? point.units) * upliftFactor)),
    upper80: Math.max(0, Math.round((point.upper80 ?? point.units) * upliftFactor)),
    lower95: Math.max(0, Math.round((point.lower95 ?? point.units) * upliftFactor)),
    upper95: Math.max(0, Math.round((point.upper95 ?? point.units) * upliftFactor))
  };
}

function applyEventUpliftsToDomainSeries(serviceCenterSeries, eventCalendar) {
  if (eventCalendar.length === 0) {
    return serviceCenterSeries;
  }

  return serviceCenterSeries.map((series) => ({
    ...series,
    method: `${series.method} + event-uplift`,
    forecast: series.forecast.map((point) => applyDomainPointUplift(point, series, eventCalendar))
  }));
}

/**
 * Rolls adjusted dealer forecasts up to state or zone level while preserving totals.
 */
function aggregateAdjustedDealers(dealerSeries, level) {
  const grouped = new Map();

  for (const dealer of dealerSeries) {
    const groupId = level === "state" ? dealer.state : dealer.zone;

    if (!grouped.has(groupId)) {
      grouped.set(groupId, {
        level,
        groupId,
        groupLabel: groupId,
        method: "aggregated-from-dealers + event-uplift",
        validation: {
          mae: null,
          rmse: null,
          mape: null
        },
        history: dealer.history.map((point) => ({
          month: point.month,
          unitsSold: 0
        })),
        forecast: dealer.forecast.map((point) => ({
          month: point.month,
          unitsSold: 0,
          lower80: 0,
          upper80: 0,
          lower95: 0,
          upper95: 0,
          dataQualityValues: [],
          biasCorrectionPoints: []
        })),
        dataQualityValues: []
      });
    }

    const aggregate = grouped.get(groupId);

    dealer.history.forEach((point, index) => {
      aggregate.history[index].unitsSold += point.unitsSold;
    });

    dealer.forecast.forEach((point, index) => {
      aggregate.forecast[index].unitsSold += point.unitsSold;
      aggregate.forecast[index].lower80 += point.lower80 ?? point.unitsSold;
      aggregate.forecast[index].upper80 += point.upper80 ?? point.unitsSold;
      aggregate.forecast[index].lower95 += point.lower95 ?? point.unitsSold;
      aggregate.forecast[index].upper95 += point.upper95 ?? point.unitsSold;
      aggregate.forecast[index].dataQualityValues.push(point.dataQuality ?? dealer.dataQuality);
      aggregate.forecast[index].biasCorrectionPoints.push(point);
    });

    aggregate.dataQualityValues.push(dealer.dataQuality);
  }

  return [...grouped.values()].map((aggregate) => ({
    ...aggregate,
    dataQuality: summarizeDataQuality(aggregate.dataQualityValues),
    biasCorrection: summarizeBiasCorrection(aggregate.forecast.flatMap((point) => point.biasCorrectionPoints)),
    forecast: aggregate.forecast.map(({ dataQualityValues, biasCorrectionPoints, ...point }) => ({
      ...point,
      dataQuality: summarizeDataQuality(dataQualityValues),
      biasCorrection: summarizeBiasCorrection(biasCorrectionPoints)
    }))
  }));
}

function summarizeCalibration(summaries) {
  const calibrationRecords = summaries.filter((record) => Number.isFinite(record.coverage80) && Number.isFinite(record.coverage95));

  if (calibrationRecords.length === 0) {
    return {
      coverage80: null,
      coverage95: null,
      sampleCount: 0,
      avgWidth80: null,
      avgWidth95: null,
      horizonWidths: []
    };
  }

  const totalSamples = calibrationRecords.reduce((sum, record) => sum + record.calibrationSampleCount, 0);
  const weightedAverage = (key) => {
    if (totalSamples === 0) {
      return null;
    }

    return Number(
      (
        calibrationRecords.reduce((sum, record) => sum + Number(record[key]) * record.calibrationSampleCount, 0) /
        totalSamples
      ).toFixed(2)
    );
  };
  const horizonGroups = new Map();

  for (const record of calibrationRecords) {
    for (const width of record.horizonWidths) {
      if (!horizonGroups.has(width.horizonMonth)) {
        horizonGroups.set(width.horizonMonth, {
          horizonMonth: width.horizonMonth,
          weightedWidth80: 0,
          weightedWidth95: 0,
          sampleCount: 0
        });
      }

      const group = horizonGroups.get(width.horizonMonth);
      const sampleCount = Number(width.sampleCount || 0);
      group.weightedWidth80 += Number(width.width80 || 0) * sampleCount;
      group.weightedWidth95 += Number(width.width95 || 0) * sampleCount;
      group.sampleCount += sampleCount;
    }
  }

  return {
    coverage80: weightedAverage("coverage80"),
    coverage95: weightedAverage("coverage95"),
    sampleCount: totalSamples,
    avgWidth80: weightedAverage("avgWidth80"),
    avgWidth95: weightedAverage("avgWidth95"),
    horizonWidths: [...horizonGroups.values()]
      .sort((left, right) => left.horizonMonth - right.horizonMonth)
      .map((group) => ({
        horizonMonth: group.horizonMonth,
        width80: group.sampleCount > 0 ? Number((group.weightedWidth80 / group.sampleCount).toFixed(2)) : 0,
        width95: group.sampleCount > 0 ? Number((group.weightedWidth95 / group.sampleCount).toFixed(2)) : 0,
        sampleCount: group.sampleCount
      }))
  };
}

function isWithinCoverageTolerance(value, target) {
  return value !== null && Math.abs(value - target) <= CALIBRATION_TOLERANCE_PERCENTAGE_POINTS;
}

function assertCalibrationWithinTolerance(calibration) {
  const coverage80Valid = isWithinCoverageTolerance(calibration.coverage80, 80);
  const coverage95Valid = isWithinCoverageTolerance(calibration.coverage95, 95);

  if (!coverage80Valid || !coverage95Valid) {
    const error = new Error(
      `Forecast interval calibration is outside tolerance: 80% coverage=${calibration.coverage80 ?? "n/a"}%, 95% coverage=${calibration.coverage95 ?? "n/a"}%`
    );
    error.code = "CALIBRATION_OUT_OF_TOLERANCE";
    throw error;
  }
}

function mean(values) {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * Builds the final dealer, state, and zone output after event uplifts are applied.
 */
function buildAdjustedForecastLevels(dealerSeries, eventCalendar) {
  const adjustedDealers = applyEventUpliftsToDealerSeries(dealerSeries, eventCalendar);

  return [
    {
      level: "dealer",
      series: adjustedDealers
    },
    {
      level: "state",
      series: aggregateAdjustedDealers(adjustedDealers, "state")
    },
    {
      level: "zone",
      series: aggregateAdjustedDealers(adjustedDealers, "zone")
    }
  ];
}

/**
 * Reads the configured horizon and clamps it to the supported 1-24 month range.
 */
function parseHorizon(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_HORIZON;
  }

  return Math.min(Math.max(Math.trunc(parsed), 1), 24);
}

function reportProgress(onProgress, progress) {
  if (typeof onProgress === "function") {
    onProgress(progress);
  }
}

/**
 * Calculates the delay from now until the next local 12:00 AM boundary.
 */
function nextMidnightDelay(now = new Date()) {
  const next = new Date(now);
  next.setHours(24, 0, 0, 0);
  return next.getTime() - now.getTime();
}

/**
 * Builds all forecast scopes: overall, model-level, and variant-level forecasts.
 */
async function fetchForecastScopes(db = pool) {
  const segmentsResult = await db.query(`
      SELECT DISTINCT segment
      FROM vehicle_models
      WHERE is_active = TRUE
        AND is_discontinued = FALSE
      ORDER BY segment
    `);
  const modelsResult = await db.query(`
      SELECT model_id, segment
      FROM vehicle_models
      WHERE is_active = TRUE
        AND is_discontinued = FALSE
      ORDER BY segment, model_id
    `);
  const variantsResult = await db.query(`
      SELECT vv.model_id, vv.variant_id, vm.segment
      FROM vehicle_variants vv
      JOIN vehicle_models vm ON vm.model_id = vv.model_id
      WHERE vv.is_active = TRUE
        AND vv.is_discontinued = FALSE
        AND vm.is_active = TRUE
        AND vm.is_discontinued = FALSE
      ORDER BY vm.segment, vv.model_id, vv.variant_id
    `);

  return [
    {
      segment: null,
      modelId: null,
      variantId: null
    },
    ...segmentsResult.rows.map((row) => ({
      segment: row.segment,
      modelId: null,
      variantId: null
    })),
    ...modelsResult.rows.map((row) => ({
      segment: row.segment,
      modelId: row.model_id,
      variantId: null
    })),
    ...variantsResult.rows.map((row) => ({
      segment: row.segment,
      modelId: row.model_id,
      variantId: row.variant_id
    }))
  ];
}

/**
 * Loads all active event uplift rules used during the current refresh.
 */
async function fetchEventCalendar(db = pool) {
  return ForecastEventCalendar.findActive(
    {
      forecastDomain: SALES_DOMAIN,
      forecastType: FORECAST_TYPE
    },
    db
  );
}

async function fetchDomainEventCalendar(domain, forecastType, db = pool) {
  return ForecastEventCalendar.findActive(
    {
      forecastDomain: domain,
      forecastType
    },
    db
  );
}

async function fetchLatestActualMonth(db = pool) {
  const result = await db.query(`
    SELECT TO_CHAR(MAX(month), 'YYYY-MM-01') AS latest_actual_month
    FROM monthly_sales_data m
    JOIN dealers d ON d.dealer_id = m.dealer_id
    JOIN vehicle_models vm ON vm.model_id = m.model_id
    JOIN vehicle_variants vv ON vv.variant_id = m.variant_id
      AND vv.model_id = m.model_id
    WHERE d.is_active = TRUE
      AND vm.is_active = TRUE
      AND vm.is_discontinued = FALSE
      AND vv.is_active = TRUE
      AND vv.is_discontinued = FALSE
  `);

  return result.rows[0]?.latest_actual_month ?? null;
}

async function fetchPartsForecastScopes(db = pool) {
  await db.query("SELECT 1");
  return [
    {
      partCategory: null,
      partId: null,
      modelId: null,
      variantId: null
    }
  ];
}

function aggregateAdjustedDomainSeries(baseSeries, level) {
  const grouped = new Map();

  for (const series of baseSeries) {
    const groupId = level === "state" ? series.state : series.zone;
    const key = [
      groupId,
      series.partId ?? "",
      series.partCategory ?? "",
      series.serviceType ?? "",
      series.jobCategory ?? "",
      series.claimType ?? "",
      series.returnReason ?? "",
      series.ageBucket ?? "",
      series.modelId ?? "",
      series.variantId ?? ""
    ].join("|");

    if (!grouped.has(key)) {
      grouped.set(key, {
        ...series,
        level,
        groupId,
        groupLabel: groupId,
        method: "aggregated-from-service-centers + event-uplift",
        validation: {
          mae: null,
          rmse: null,
          mape: null
        },
        forecast: series.forecast.map((point) => ({
          month: point.month,
          units: 0,
          expectedBreaches: 0,
          riskScore: 0,
          riskScorePoints: [],
          lower80: 0,
          upper80: 0,
          lower95: 0,
          upper95: 0
        }))
      });
    }

    const aggregate = grouped.get(key);
    series.forecast.forEach((point, index) => {
      aggregate.forecast[index].units += point.units;
      aggregate.forecast[index].expectedBreaches += point.expectedBreaches ?? point.units ?? 0;
      if (Number.isFinite(Number(point.riskScore))) {
        aggregate.forecast[index].riskScorePoints.push(Number(point.riskScore));
      }
      aggregate.forecast[index].lower80 += point.lower80 ?? point.units;
      aggregate.forecast[index].upper80 += point.upper80 ?? point.units;
      aggregate.forecast[index].lower95 += point.lower95 ?? point.units;
      aggregate.forecast[index].upper95 += point.upper95 ?? point.units;
    });
  }

  return [...grouped.values()].map((series) => ({
    ...series,
    forecast: series.forecast.map((point) => {
      const riskScore = point.riskScorePoints.length
        ? point.riskScorePoints.reduce((sum, value) => sum + value, 0) / point.riskScorePoints.length
        : Math.min(100, (point.expectedBreaches || point.units || 0) * 6);

      return {
        ...point,
        riskScore: Number(riskScore.toFixed(2)),
        breachProbability: Number(Math.min(1, (point.expectedBreaches || point.units || 0) / 100).toFixed(4)),
        riskLevel: riskLevelFromScore(riskScore)
      };
    })
  }));
}

function buildAdjustedDomainForecastLevels(serviceCenterSeries, eventCalendar) {
  const adjustedServiceCenters = applyEventUpliftsToDomainSeries(serviceCenterSeries, eventCalendar);

  return [
    {
      level: "service_center",
      series: adjustedServiceCenters
    },
    {
      level: "state",
      series: aggregateAdjustedDomainSeries(adjustedServiceCenters, "state")
    },
    {
      level: "zone",
      series: aggregateAdjustedDomainSeries(adjustedServiceCenters, "zone")
    }
  ];
}

async function fetchServiceForecastScopes(db = pool) {
  await db.query("SELECT 1");
  return [
    {
      serviceType: null,
      jobCategory: null,
      modelId: null,
      variantId: null
    }
  ];
}

function riskLevelFromScore(score) {
  const numericScore = Number(score || 0);
  if (numericScore >= 75) return "Critical";
  if (numericScore >= 50) return "High";
  if (numericScore >= 25) return "Medium";
  return "Low";
}

async function fetchSlaForecastScopes(db = pool) {
  await db.query("SELECT 1");
  return [
    {
      serviceType: null,
      jobCategory: null,
      modelId: null,
      variantId: null
    }
  ];
}

async function fetchWarrantyForecastScopes(db = pool) {
  await db.query("SELECT 1");
  return [
    {
      claimType: null,
      returnReason: null,
      ageBucket: null,
      modelId: null,
      variantId: null
    }
  ];
}

function addMonths(month, offset) {
  const date = new Date(`${month}T00:00:00.000Z`);
  date.setUTCMonth(date.getUTCMonth() + offset);
  const year = date.getUTCFullYear();
  const nextMonth = String(date.getUTCMonth() + 1).padStart(2, "0");

  return `${year}-${nextMonth}-01`;
}

/**
 * Converts nested forecast output into rows that match the forecast_data table.
 */
function flattenForecast({ runId, scope, forecast }) {
  // The forecasting engine returns nested levels and series. Storage is flat so
  // the API can filter by level/group/product dimensions efficiently.
  const records = [];

  for (const levelResult of forecast.levels) {
    for (const series of levelResult.series) {
      for (const point of series.forecast) {
        const horizonMonth = series.forecast.indexOf(point) + 1;
        records.push({
          runId,
          forecastType: FORECAST_TYPE,
          level: series.level,
          groupId: series.groupId,
          groupLabel: series.groupLabel,
          segment: scope.segment,
          modelId: scope.modelId,
          variantId: scope.variantId,
          forecastMonth: point.month,
          forecastUnits: point.unitsSold,
          lower80: point.lower80 ?? point.unitsSold,
          upper80: point.upper80 ?? point.unitsSold,
          lower95: point.lower95 ?? point.unitsSold,
          upper95: point.upper95 ?? point.unitsSold,
          horizonMonth,
          modelMethod: series.method,
          validationMae: series.validation.mae,
          validationRmse: series.validation.rmse,
          validationMape: series.validation.mape,
          dataQuality: point.dataQuality ?? series.dataQuality ?? "rich",
          biasCorrection: point.biasCorrection ?? series.biasCorrection ?? 1
        });
      }
    }
  }

  return records;
}

function flattenDomainForecast({ domain, runId, scope, forecast }) {
  const forecastType = domain === PARTS_DOMAIN
    ? PARTS_FORECAST_TYPE
    : domain === SERVICE_DOMAIN
      ? SERVICE_FORECAST_TYPE
      : domain === SLA_DOMAIN
        ? SLA_FORECAST_TYPE
        : WARRANTY_FORECAST_TYPE;
  const records = [];

  for (const levelResult of forecast.levels) {
    for (const series of levelResult.series) {
      for (const [index, point] of series.forecast.entries()) {
        const units = roundUnits(point.units);
        const slaRiskScore = domain === SLA_DOMAIN
          ? Number(point.riskScore ?? Math.min(100, units * 6))
          : point.riskScore ?? null;
        records.push({
          runId,
          forecastType,
          level: series.level,
          groupId: series.groupId,
          groupLabel: series.groupLabel,
          partId: series.partId ?? scope.partId ?? null,
          partCategory: series.partCategory ?? scope.partCategory ?? null,
          serviceType: series.serviceType ?? scope.serviceType ?? null,
          jobCategory: series.jobCategory ?? scope.jobCategory ?? null,
          claimType: series.claimType ?? scope.claimType ?? null,
          returnReason: series.returnReason ?? scope.returnReason ?? null,
          ageBucket: series.ageBucket ?? scope.ageBucket ?? null,
          modelId: series.modelId ?? scope.modelId ?? null,
          variantId: series.variantId ?? scope.variantId ?? null,
          forecastMonth: point.month,
          forecastUnits: units,
          forecastOrders: units,
          expectedBreaches: point.expectedBreaches ?? units,
          breachProbability: point.breachProbability ?? null,
          riskScore: slaRiskScore,
          riskLevel: domain === SLA_DOMAIN ? (point.riskLevel ?? riskLevelFromScore(slaRiskScore)) : point.riskLevel ?? null,
          lower80: roundUnits(point.lower80 ?? point.units),
          upper80: roundUnits(point.upper80 ?? point.units),
          lower95: roundUnits(point.lower95 ?? point.units),
          upper95: roundUnits(point.upper95 ?? point.units),
          horizonMonth: index + 1,
          modelMethod: series.method,
          validationMae: series.validation.mae,
          validationRmse: series.validation.rmse,
          validationMape: series.validation.mape,
          dataQuality: series.method.startsWith("croston") ? "intermittent" : "rich"
        });
      }
    }
  }

  return records;
}

function collectCalibrationSummaries({ scope, forecast }) {
  const summaries = [];
  const dealerLevel = forecast.levels.find((levelResult) => levelResult.level === "dealer");

  for (const series of dealerLevel?.series ?? []) {
    const calibration = series.calibration;

    if (!calibration || !Number.isFinite(calibration.coverage80) || !Number.isFinite(calibration.coverage95)) {
      continue;
    }

    const horizonWidths = series.forecast.map((point, index) => {
      const calibrationWidth = calibration.horizonWidths?.[index];

      return {
        horizonMonth: index + 1,
        width80: (point.upper80 ?? point.unitsSold) - (point.lower80 ?? point.unitsSold),
        width95: (point.upper95 ?? point.unitsSold) - (point.lower95 ?? point.unitsSold),
        sampleCount: calibrationWidth?.sampleCount ?? 0
      };
    });

    summaries.push({
      seriesKey: `${scope.segment ?? ""}:${scope.modelId ?? ""}:${scope.variantId ?? ""}:${series.groupId}`,
      coverage80: calibration.coverage80,
      coverage95: calibration.coverage95,
      calibrationSampleCount: calibration.sampleCount,
      avgWidth80: Number(mean(horizonWidths.map((item) => item.width80)).toFixed(2)),
      avgWidth95: Number(mean(horizonWidths.map((item) => item.width95)).toFixed(2)),
      horizonWidths
    });
  }

  return summaries;
}

function collectDomainCalibrationSummaries({ scope, forecast }) {
  const summaries = [];
  const serviceCenterLevel = forecast.levels.find((levelResult) => levelResult.level === "service_center");

  for (const series of serviceCenterLevel?.series ?? []) {
    const calibration = series.calibration;

    if (!calibration || !Number.isFinite(calibration.coverage80) || !Number.isFinite(calibration.coverage95)) {
      continue;
    }

    const horizonWidths = series.forecast.map((point, index) => {
      const calibrationWidth = calibration.horizonWidths?.[index];

      return {
        horizonMonth: index + 1,
        width80: (point.upper80 ?? point.units) - (point.lower80 ?? point.units),
        width95: (point.upper95 ?? point.units) - (point.lower95 ?? point.units),
        sampleCount: calibrationWidth?.sampleCount ?? 0
      };
    });

    summaries.push({
      seriesKey: [
        scope.partId ?? "",
        scope.partCategory ?? "",
        scope.serviceType ?? "",
        scope.jobCategory ?? "",
        scope.claimType ?? "",
        scope.returnReason ?? "",
        scope.ageBucket ?? "",
        scope.modelId ?? "",
        scope.variantId ?? "",
        series.groupId
      ].join(":"),
      coverage80: calibration.coverage80,
      coverage95: calibration.coverage95,
      calibrationSampleCount: calibration.sampleCount,
      avgWidth80: Number(mean(horizonWidths.map((item) => item.width80)).toFixed(2)),
      avgWidth95: Number(mean(horizonWidths.map((item) => item.width95)).toFixed(2)),
      horizonWidths
    });
  }

  return summaries;
}

/**
 * Inserts forecast rows in chunks to keep SQL statements at a manageable size.
 */
async function insertInBatches(records, db = pool) {
  let inserted = 0;

  for (let index = 0; index < records.length; index += MAX_BATCH_SIZE) {
    inserted += await ForecastData.insertMany(records.slice(index, index + MAX_BATCH_SIZE), db);
  }

  return inserted;
}

async function insertDomainInBatches(domain, records, db = pool, { onConflict = true } = {}) {
  let inserted = 0;

  for (let index = 0; index < records.length; index += MAX_BATCH_SIZE) {
    inserted += await DomainForecastData.insertMany(domain, records.slice(index, index + MAX_BATCH_SIZE), db, { onConflict });
  }

  return inserted;
}

/**
 * Deletes any previously stored rows that are no longer present in the current rerun output.
 */
async function removeIrrelevantRows(records, db, latestActualMonth) {
  const currentKeys = new Set(
    records.map((record) =>
      buildForecastKey({
        forecastType: record.forecastType,
        level: record.level,
        groupId: record.groupId,
        segment: record.segment,
        modelId: record.modelId,
        variantId: record.variantId,
        forecastMonth: record.forecastMonth
      })
    )
  );
  const existingRows = await ForecastData.findKeysByForecastType(FORECAST_TYPE, db);
  const idsToDelete = existingRows
    .filter(
      (row) =>
        (!latestActualMonth || row.forecast_month > latestActualMonth) &&
        !currentKeys.has(
          buildForecastKey({
            forecastType: row.forecast_type,
            level: row.level,
            groupId: row.group_id,
            segment: row.segment,
            modelId: row.model_id,
            variantId: row.variant_id,
            forecastMonth: row.forecast_month
          })
        )
    )
    .map((row) => row.forecast_id);

  return ForecastData.deleteByIds(idsToDelete, db);
}

/**
 * Runs one complete forecast generation cycle and stores the results in Postgres.
 */
export async function runForecastWorker({
  horizon = parseHorizon(process.env.FORECAST_HORIZON_MONTHS),
  onProgress
} = {}) {
  const client = await pool.connect();
  let run = null;

  reportProgress(onProgress, {
    stage: "initializing",
    stageLabel: "Initializing",
    message: `Preparing ${horizon}-month forecast regeneration.`,
    horizon
  });

  try {
    const lockResult = await client.query("SELECT pg_try_advisory_lock($1) AS locked", [workerLockId]);
    if (!lockResult.rows[0]?.locked) {
      console.log("Forecast worker skipped because another run is already active");
      reportProgress(onProgress, {
        running: false,
        stage: "failed",
        stageLabel: "Failed",
        message: "Another forecast generation is already active.",
        error: "Another forecast generation is already active."
      });
      return {
        skipped: true,
        reason: "lock-not-acquired"
      };
    }

    run = await ForecastRun.create(
      {
        forecastDomain: SALES_DOMAIN,
        forecastType: FORECAST_TYPE,
        horizonMonths: horizon
      },
      client
    );
    await client.query("BEGIN");

    reportProgress(onProgress, {
      stage: "loading-source-data",
      stageLabel: "Loading source data",
      message: "Loading monthly sales history, bias corrections, and event rules.",
      runId: run.run_id
    });

    const initialBiasSummary = await ForecastBiasService.computeAndStore({ windowMonths: 6 }, client);
    const biasCorrections = await ForecastBiasService.findCorrectionMap(client);
    const scopes = await fetchForecastScopes(client);
    const eventCalendar = await fetchEventCalendar(client);
    const latestActualMonth = await fetchLatestActualMonth(client);
    const actualizedHistoryEndMonth = latestActualMonth ? addMonths(latestActualMonth, -1) : null;
    const allRecords = [];
    const allCalibrationSummaries = [];
    reportProgress(onProgress, {
      stage: "processing",
      stageLabel: "Processing",
      message: `Generating forecast scopes (0/${scopes.length}).`,
      runId: run.run_id,
      totalScopes: scopes.length,
      processedScopes: 0
    });

    for (const [index, scope] of scopes.entries()) {
      const dealerForecast = await buildBaselineForecast({
        level: "dealer",
        horizon,
        segment: scope.segment,
        modelId: scope.modelId,
        variantId: scope.variantId,
        biasCorrections
      });
      const actualizedDealerForecast = latestActualMonth
        ? await buildBaselineForecast({
          level: "dealer",
          horizon: 1,
          segment: scope.segment,
          modelId: scope.modelId,
          variantId: scope.variantId,
          historyEndMonth: actualizedHistoryEndMonth,
          forecastStartMonth: latestActualMonth,
          biasCorrections
        })
        : null;
      const adjustedForecast = {
        ...dealerForecast,
        levels: buildAdjustedForecastLevels(dealerForecast.levels[0]?.series ?? [], eventCalendar)
      };
      const actualizedAdjustedForecast = actualizedDealerForecast
        ? {
          ...actualizedDealerForecast,
          levels: buildAdjustedForecastLevels(actualizedDealerForecast.levels[0]?.series ?? [], eventCalendar)
        }
        : null;

      allRecords.push(
        ...flattenForecast({
          runId: run.run_id,
          scope,
          forecast: adjustedForecast
        })
      );

      if (actualizedAdjustedForecast) {
        allRecords.push(
          ...flattenForecast({
            runId: run.run_id,
            scope,
            forecast: actualizedAdjustedForecast
          })
        );
      }
      allCalibrationSummaries.push(
        ...collectCalibrationSummaries({
          scope,
          forecast: adjustedForecast
        })
      );

      reportProgress(onProgress, {
        stage: "processing",
        stageLabel: "Processing",
        message: `Generating forecast scopes (${index + 1}/${scopes.length}).`,
        runId: run.run_id,
        totalScopes: scopes.length,
        processedScopes: index + 1
      });
    }

    reportProgress(onProgress, {
      stage: "saving-results",
      stageLabel: "Saving forecast rows",
      message: "Saving generated forecast data.",
      runId: run.run_id,
      totalScopes: scopes.length,
      processedScopes: scopes.length
    });
    const inserted = await insertInBatches(allRecords, client);
    const removed = await removeIrrelevantRows(allRecords, client, latestActualMonth);
    const biasSummary = await ForecastBiasService.computeAndStore({ windowMonths: 6 }, client);
    const calibration = summarizeCalibration(allCalibrationSummaries);
    assertCalibrationWithinTolerance(calibration);
    const completedRun = await ForecastRun.complete(run.run_id, calibration, client);
    await client.query("COMMIT");
    ForecastCacheService.clear();
    reportProgress(onProgress, {
      runId: completedRun.run_id,
      stage: "finished",
      stageLabel: "Finished successfully",
      message: "Forecast regeneration finished successfully.",
      inserted,
      removed,
      calibration,
      initialBiasSummary,
      biasSummary,
      totalScopes: scopes.length,
      processedScopes: scopes.length
    });

    console.log(
      `Forecast worker completed run ${completedRun.run_id}: ${inserted} upserted rows, ${removed} removed rows across ${scopes.length} scopes`
    );

    return {
      skipped: false,
      runId: completedRun.run_id,
      inserted,
      removed,
      initialBiasSummary,
      biasSummary,
      scopes: scopes.length
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});

    if (run) {
      await ForecastRun.fail(run.run_id, error.message);
    }
    reportProgress(onProgress, {
      runId: run?.run_id ?? null,
      stage: "failed",
      stageLabel: "Failed",
      message: error.message || "Forecast worker failed.",
      error: error.message || "Forecast worker failed."
    });
    console.error("Forecast worker failed", error);
    throw error;
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [workerLockId]).catch(() => {});
    client.release();
  }
}

export async function runPartsForecastWorker({
  horizon = parseHorizon(process.env.FORECAST_HORIZON_MONTHS),
  onProgress
} = {}) {
  return runDomainForecastWorker({
    domain: PARTS_DOMAIN,
    forecastType: PARTS_FORECAST_TYPE,
    horizon,
    fetchScopes: fetchPartsForecastScopes,
    buildForecast: (scope, db) => buildPartsDemandForecast({ horizon, scope, db }),
    onProgress
  });
}

export async function runServiceForecastWorker({
  horizon = parseHorizon(process.env.FORECAST_HORIZON_MONTHS),
  onProgress
} = {}) {
  return runDomainForecastWorker({
    domain: SERVICE_DOMAIN,
    forecastType: SERVICE_FORECAST_TYPE,
    horizon,
    fetchScopes: fetchServiceForecastScopes,
    buildForecast: (scope, db) => buildServiceOrderForecast({ horizon, scope, db }),
    onProgress
  });
}

export async function runWarrantyForecastWorker({
  horizon = parseHorizon(process.env.FORECAST_HORIZON_MONTHS),
  onProgress
} = {}) {
  return runDomainForecastWorker({
    domain: WARRANTY_DOMAIN,
    forecastType: WARRANTY_FORECAST_TYPE,
    horizon,
    fetchScopes: fetchWarrantyForecastScopes,
    buildForecast: (scope, db) => buildWarrantyReturnsForecast({ horizon, scope, db }),
    onProgress
  });
}

export async function runSlaForecastWorker({
  horizon = parseHorizon(process.env.FORECAST_HORIZON_MONTHS),
  onProgress
} = {}) {
  return runDomainForecastWorker({
    domain: SLA_DOMAIN,
    forecastType: SLA_FORECAST_TYPE,
    horizon,
    fetchScopes: fetchSlaForecastScopes,
    buildForecast: (scope, db) => buildSlaBreachRiskForecast({ horizon, scope, db }),
    onProgress
  });
}

export async function runAllForecastWorkers({
  horizon = parseHorizon(process.env.FORECAST_HORIZON_MONTHS),
  onProgress
} = {}) {
  const sales = await runForecastWorker({
    horizon,
    onProgress: (progress) => reportProgress(onProgress, { ...progress, forecastDomain: SALES_DOMAIN })
  });
  const parts = await runPartsForecastWorker({
    horizon,
    onProgress: (progress) => reportProgress(onProgress, { ...progress, forecastDomain: PARTS_DOMAIN })
  });
  const service = await runServiceForecastWorker({
    horizon,
    onProgress: (progress) => reportProgress(onProgress, { ...progress, forecastDomain: SERVICE_DOMAIN })
  });
  const warranty = await runWarrantyForecastWorker({
    horizon,
    onProgress: (progress) => reportProgress(onProgress, { ...progress, forecastDomain: WARRANTY_DOMAIN })
  });
  const sla = await runSlaForecastWorker({
    horizon,
    onProgress: (progress) => reportProgress(onProgress, { ...progress, forecastDomain: SLA_DOMAIN })
  });

  return {
    sales,
    parts,
    service,
    warranty,
    sla
  };
}

async function runDomainForecastWorker({
  domain,
  forecastType,
  horizon,
  fetchScopes,
  buildForecast,
  onProgress
}) {
  const client = await pool.connect();
  let run = null;

  reportProgress(onProgress, {
    stage: "initializing",
    stageLabel: "Initializing",
    message: `Preparing ${domain} ${horizon}-month forecast regeneration.`,
    horizon
  });

  try {
    const lockId = domainWorkerLockIds[domain];
    if (lockId) {
      const lockResult = await client.query("SELECT pg_try_advisory_lock($1) AS locked", [lockId]);
      if (!lockResult.rows[0]?.locked) {
        reportProgress(onProgress, {
          running: false,
          stage: "failed",
          stageLabel: "Failed",
          message: `Another ${domain} forecast generation is already active.`,
          error: `Another ${domain} forecast generation is already active.`
        });
        return {
          skipped: true,
          reason: "lock-not-acquired"
        };
      }
    }

    run = await ForecastRun.create(
      {
        forecastDomain: domain,
        forecastType,
        horizonMonths: horizon
      },
      client
    );
    await client.query("BEGIN");

    reportProgress(onProgress, {
      stage: "loading-source-data",
      stageLabel: "Loading source data",
      message: `Loading ${domain} source history.`,
      runId: run.run_id
    });

    const scopes = await fetchScopes(client);
    const eventCalendar = await fetchDomainEventCalendar(domain, forecastType, client);
    const allRecords = [];
    const allCalibrationSummaries = [];

    reportProgress(onProgress, {
      stage: "processing",
      stageLabel: "Processing",
      message: `Generating ${domain} forecast scopes (0/${scopes.length}).`,
      runId: run.run_id,
      totalScopes: scopes.length,
      processedScopes: 0
    });

    for (const [index, scope] of scopes.entries()) {
      const rawForecast = await buildForecast(scope, client);
      const forecast = {
        ...rawForecast,
        levels: buildAdjustedDomainForecastLevels(
          rawForecast.levels.find((levelResult) => levelResult.level === "service_center")?.series ?? [],
          eventCalendar
        )
      };
      const scopeRecords = flattenDomainForecast({
        domain,
        runId: run.run_id,
        scope,
        forecast
      });

      for (const record of scopeRecords) {
        allRecords.push(record);
      }
      allCalibrationSummaries.push(
        ...collectDomainCalibrationSummaries({
          scope,
          forecast
        })
      );

      reportProgress(onProgress, {
        stage: "processing",
        stageLabel: "Processing",
        message: `Generating ${domain} forecast scopes (${index + 1}/${scopes.length}).`,
        runId: run.run_id,
        totalScopes: scopes.length,
        processedScopes: index + 1
      });
    }

    reportProgress(onProgress, {
      stage: "saving-results",
      stageLabel: "Saving forecast rows",
      message: `Saving generated ${domain} forecast data.`,
      runId: run.run_id,
      totalScopes: scopes.length,
      processedScopes: scopes.length
    });

    const dataDomain = domainDataKey(domain);
    const removed = await DomainForecastData.clearFuture(dataDomain, forecastType, client);
    const inserted = await insertDomainInBatches(dataDomain, allRecords, client, { onConflict: false });
    // SLA stores risk-specific fields that do not fit the shared unit-rollup
    // table yet, so dashboard queries read directly from sla_forecast_data.
    if (domain !== SLA_DOMAIN) {
      await DomainForecastRollup.refresh({
        forecastDomain: domain,
        runId: run.run_id,
        forecastType
      }, client);
    }
    const calibration = summarizeCalibration(allCalibrationSummaries);
    const completedRun = await ForecastRun.complete(run.run_id, calibration, client);

    await client.query("COMMIT");
    ForecastCacheService.clear();
    reportProgress(onProgress, {
      runId: completedRun.run_id,
      stage: "finished",
      stageLabel: "Finished successfully",
      message: `${domain} forecast regeneration finished successfully.`,
      inserted,
      removed,
      calibration,
      totalScopes: scopes.length,
      processedScopes: scopes.length
    });

    console.log(`Forecast worker completed ${domain} run ${completedRun.run_id}: ${inserted} upserted rows across ${scopes.length} scopes`);

    return {
      skipped: false,
      runId: completedRun.run_id,
      inserted,
      removed,
      calibration,
      scopes: scopes.length
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});

    if (run) {
      await ForecastRun.fail(run.run_id, error.message);
    }
    reportProgress(onProgress, {
      runId: run?.run_id ?? null,
      stage: "failed",
      stageLabel: "Failed",
      message: error.message || `${domain} forecast worker failed.`,
      error: error.message || `${domain} forecast worker failed.`
    });
    console.error(`${domain} forecast worker failed`, error);
    throw error;
  } finally {
    const lockId = domainWorkerLockIds[domain];
    if (lockId) {
      await client.query("SELECT pg_advisory_unlock($1)", [lockId]).catch(() => {});
    }
    client.release();
  }
}

/**
 * Keeps the worker process alive and schedules the next run for midnight.
 */
function scheduleNextRun() {
  const delay = nextMidnightDelay();
  const runAt = new Date(Date.now() + delay);

  console.log(`Forecast worker scheduled for ${runAt.toLocaleString()}`);

  setTimeout(async () => {
    try {
      await runAllForecastWorkers();
    } catch {
      // Failure is already logged and stored in forecast_runs.
    } finally {
      scheduleNextRun();
    }
  }, delay);
}

if (process.argv[1] === currentFile) {
  const runOnce = process.argv.includes("--once");
  const domainArgument = process.argv.find((argument) => argument.startsWith("--domain="));
  const requestedDomain = domainArgument?.split("=")[1] ?? "all";
  const runnerByDomain = {
    all: runAllForecastWorkers,
    sales: runForecastWorker,
    parts: runPartsForecastWorker,
    service: runServiceForecastWorker,
    warranty: runWarrantyForecastWorker,
    sla: runSlaForecastWorker
  };
  const runner = runnerByDomain[requestedDomain] ?? runAllForecastWorkers;

  if (runOnce) {
    runner()
      .then(async () => {
        await pool.end();
      })
      .catch(async () => {
        await pool.end();
        process.exit(1);
      });
  } else {
    scheduleNextRun();
  }
}
