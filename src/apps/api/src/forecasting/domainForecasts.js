import { pool } from "../db.js";

const DEFAULT_HORIZON = 6;
const MAX_HORIZON = 24;
const MIN_HISTORY_POINTS = 3;
const MIN_CALIBRATION_HISTORY_POINTS = 4;
const CALIBRATION_TOLERANCE_PERCENTAGE_POINTS = 2;
const CALIBRATION_ADJUSTMENT_STEPS = 40;
const SEASONAL_MIN_HISTORY_POINTS = 12;
const SEASONAL_SHRINKAGE = 0.65;
const MIN_SEASONAL_FACTOR = 0.65;
const MAX_SEASONAL_FACTOR = 1.35;

function clampHorizon(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_HORIZON;
  }

  return Math.min(Math.max(Math.trunc(parsed), 1), MAX_HORIZON);
}

function formatMonth(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}-01`;
}

function addMonths(month, offset) {
  const date = new Date(`${month}T00:00:00.000Z`);
  date.setUTCMonth(date.getUTCMonth() + offset);
  return formatMonth(date);
}

function monthIndex(month) {
  return new Date(`${month}T00:00:00.000Z`).getUTCMonth();
}

function buildMonthRange(startMonth, endMonth) {
  const months = [];
  let cursor = startMonth;

  while (cursor <= endMonth) {
    months.push(cursor);
    cursor = addMonths(cursor, 1);
  }

  return months;
}

function roundUnits(value) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.round(value));
}

function mean(values) {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}

function quantile(values, percentile) {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);

  if (sorted.length === 0) {
    return 0;
  }

  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(percentile * sorted.length) - 1));
  return sorted[index];
}

function enforceNonDecreasing(values) {
  let previous = 0;

  return values.map((value) => {
    const next = Math.max(previous, Number.isFinite(value) ? value : previous);
    previous = next;
    return next;
  });
}

function errors(actuals, forecasts) {
  const count = Math.min(actuals.length, forecasts.length);
  if (count === 0) {
    return {
      mae: null,
      rmse: null,
      mape: null
    };
  }

  let absolute = 0;
  let squared = 0;
  let percentage = 0;
  let percentageCount = 0;

  for (let index = 0; index < count; index += 1) {
    const actual = actuals[index];
    const forecast = forecasts[index];
    const difference = actual - forecast;
    absolute += Math.abs(difference);
    squared += difference ** 2;

    if (actual !== 0) {
      percentage += Math.abs(difference / actual);
      percentageCount += 1;
    }
  }

  return {
    mae: Number((absolute / count).toFixed(2)),
    rmse: Number(Math.sqrt(squared / count).toFixed(2)),
    mape: percentageCount > 0 ? Number(((percentage / percentageCount) * 100).toFixed(2)) : null
  };
}

function movingAverageForecast(values, horizon, window = 3) {
  const recent = values.slice(-Math.min(values.length, window));
  return trendAdjustForecast(values, Array(horizon).fill(mean(recent)));
}

function crostonForecast(values, horizon, alpha = 0.2) {
  let demand = null;
  let interval = null;
  let periodsSinceDemand = 0;
  let nonZeroCount = 0;

  for (const value of values) {
    periodsSinceDemand += 1;
    if (value <= 0) {
      continue;
    }

    nonZeroCount += 1;
    if (demand === null) {
      demand = value;
      interval = periodsSinceDemand;
    } else {
      demand = alpha * value + (1 - alpha) * demand;
      interval = alpha * periodsSinceDemand + (1 - alpha) * interval;
    }
    periodsSinceDemand = 0;
  }

  if (nonZeroCount === 0 || !interval) {
    return Array(horizon).fill(0);
  }

  return trendAdjustForecast(values, Array(horizon).fill(demand / interval));
}

function hasIntermittentDemand(values) {
  const nonZeroCount = values.filter((value) => value > 0).length;
  return nonZeroCount > 0 && nonZeroCount / Math.max(values.length, 1) <= 0.65;
}

function estimateMonthlyTrend(values) {
  const usableValues = values.filter((value) => Number.isFinite(value));
  if (usableValues.length < 4) {
    return 0;
  }

  const window = Math.min(3, Math.floor(usableValues.length / 2));
  const firstAverage = mean(usableValues.slice(0, window));
  const lastAverage = mean(usableValues.slice(-window));
  if (firstAverage <= 0) {
    return 0;
  }

  const rawTrend = (lastAverage - firstAverage) / firstAverage / Math.max(usableValues.length - window, 1);
  return Math.max(-0.08, Math.min(0.08, rawTrend));
}

function trendAdjustForecast(values, baseForecast) {
  const monthlyTrend = estimateMonthlyTrend(values);
  return baseForecast.map((units, index) => {
    const dampening = 1 / (1 + index * 0.12);
    const trendFactor = 1 + monthlyTrend * (index + 1) * dampening;
    return Math.max(0, units * Math.max(0.35, trendFactor));
  });
}

function buildMonthlySeasonalFactors(history) {
  const usableHistory = history.filter((point) => Number.isFinite(point.units));
  const positiveValues = usableHistory.map((point) => point.units).filter((units) => units > 0);
  const overallMean = mean(positiveValues);
  const factors = Array(12).fill(1);

  if (usableHistory.length < SEASONAL_MIN_HISTORY_POINTS || overallMean <= 0) {
    return factors;
  }

  const unitsByMonth = Array.from({ length: 12 }, () => []);
  usableHistory.forEach((point) => {
    unitsByMonth[monthIndex(point.month)].push(point.units);
  });

  const rawFactors = unitsByMonth.map((values) => {
    const positiveMonthValues = values.filter((units) => units > 0);
    if (positiveMonthValues.length === 0) {
      return 1;
    }

    const rawFactor = mean(positiveMonthValues) / overallMean;
    return clamp(1 + (rawFactor - 1) * SEASONAL_SHRINKAGE, MIN_SEASONAL_FACTOR, MAX_SEASONAL_FACTOR);
  });
  const representedFactors = rawFactors.filter((factor, index) => unitsByMonth[index].length > 0);
  const normalizationFactor = mean(representedFactors) || 1;

  return rawFactors.map((factor) => clamp(factor / normalizationFactor, MIN_SEASONAL_FACTOR, MAX_SEASONAL_FACTOR));
}

function applySeasonality(point, factor) {
  return {
    ...point,
    units: Math.max(0, point.units * factor),
    lower80: Math.max(0, point.lower80 * factor),
    upper80: Math.max(0, point.upper80 * factor),
    lower95: Math.max(0, point.lower95 * factor),
    upper95: Math.max(0, point.upper95 * factor)
  };
}

function applyMonthlySeasonality(forecastPoints, history, lastMonth) {
  const seasonalFactors = buildMonthlySeasonalFactors(history);
  const hasSeasonality = seasonalFactors.some((factor) => Math.abs(factor - 1) > 0.01);

  if (!hasSeasonality || !lastMonth) {
    return {
      forecast: forecastPoints,
      applied: false
    };
  }

  return {
    forecast: forecastPoints.map((point, index) => {
      const forecastMonth = addMonths(lastMonth, index + 1);
      return applySeasonality(point, seasonalFactors[monthIndex(forecastMonth)]);
    }),
    applied: true
  };
}

function fitSeries(values, horizon, preferredMethod) {
  const fallbackCalibration = buildEmptyCalibration(horizon);
  if (values.length < MIN_HISTORY_POINTS) {
    const forecast = movingAverageForecast(values, horizon, 2);
    return {
      method: "moving-average(2)",
      forecast,
      intervalForecast: buildForecastPoints(forecast, horizon, fallbackCalibration),
      calibration: fallbackCalibration.calibration,
      validation: {
        mae: null,
        rmse: null,
        mape: null
      }
    };
  }

  const validationWindow = Math.min(3, Math.max(1, Math.floor(values.length / 3)));
  const train = values.slice(0, -validationWindow);
  const actuals = values.slice(-validationWindow);
  const useCroston = preferredMethod === "croston" && hasIntermittentDemand(values);
  const method = useCroston ? "croston(alpha=0.2)" : "moving-average(3)";
  const holdoutForecast = useCroston
    ? crostonForecast(train, validationWindow)
    : movingAverageForecast(train, validationWindow, 3);
  const forecast = useCroston
    ? crostonForecast(values, horizon)
    : movingAverageForecast(values, horizon, 3);
  const validation = errors(actuals, holdoutForecast);
  const fallbackScale = validation.rmse ?? validation.mae ?? Math.max(1, mean(values) * 0.2);
  const intervalCalibration = buildCalibration(values, horizon, method, preferredMethod, fallbackScale);

  return {
    method,
    forecast,
    intervalForecast: buildForecastPoints(forecast, horizon, intervalCalibration),
    calibration: intervalCalibration.calibration,
    validation
  };
}

function forecastByMethod(values, horizon, method, preferredMethod) {
  if (method === "moving-average(2)") {
    return movingAverageForecast(values, horizon, 2);
  }

  if (method === "croston(alpha=0.2)") {
    return crostonForecast(values, horizon);
  }

  if (method === "moving-average(3)") {
    return movingAverageForecast(values, horizon, 3);
  }

  return preferredMethod === "croston" && hasIntermittentDemand(values)
    ? crostonForecast(values, horizon)
    : movingAverageForecast(values, horizon, 3);
}

function calculateCoverage(residualsByHorizon, residual80, residual95) {
  let covered80 = 0;
  let covered95 = 0;
  let sampleCount = 0;

  residualsByHorizon.forEach((residuals, horizonIndex) => {
    residuals.forEach((residual) => {
      if (residual <= residual80[horizonIndex]) {
        covered80 += 1;
      }

      if (residual <= residual95[horizonIndex]) {
        covered95 += 1;
      }

      sampleCount += 1;
    });
  });

  return {
    coverage80: sampleCount > 0 ? Number(((covered80 / sampleCount) * 100).toFixed(2)) : null,
    coverage95: sampleCount > 0 ? Number(((covered95 / sampleCount) * 100).toFixed(2)) : null,
    sampleCount
  };
}

function isWithinCoverageTolerance(value, target) {
  return value !== null && Math.abs(value - target) <= CALIBRATION_TOLERANCE_PERCENTAGE_POINTS;
}

function scaleResiduals(values, factor, minimums = []) {
  return enforceNonDecreasing(
    values.map((value, index) => Math.max(value * factor, minimums[index] ?? 0))
  );
}

function chooseAdjustedResiduals(residualsByHorizon, baseResiduals, target, coverageKey, minimums = []) {
  const currentCoverage = (residuals) => calculateCoverage(residualsByHorizon, residuals, residuals)[coverageKey];
  const initialCoverage = currentCoverage(baseResiduals);

  if (isWithinCoverageTolerance(initialCoverage, target)) {
    return baseResiduals;
  }

  const isUnderCovered = initialCoverage === null || initialCoverage < target - CALIBRATION_TOLERANCE_PERCENTAGE_POINTS;
  let low = isUnderCovered ? 1 : 0;
  let high = isUnderCovered ? 2 : 1;
  let bestResiduals = baseResiduals;
  let bestDistance = initialCoverage === null ? Number.POSITIVE_INFINITY : Math.abs(initialCoverage - target);

  if (isUnderCovered) {
    for (let step = 0; step < CALIBRATION_ADJUSTMENT_STEPS; step += 1) {
      const candidate = scaleResiduals(baseResiduals, high, minimums);
      const coverage = currentCoverage(candidate);

      if (coverage !== null && Math.abs(coverage - target) < bestDistance) {
        bestDistance = Math.abs(coverage - target);
        bestResiduals = candidate;
      }

      if (coverage !== null && coverage >= target - CALIBRATION_TOLERANCE_PERCENTAGE_POINTS) {
        break;
      }

      high *= 2;
    }
  }

  for (let step = 0; step < CALIBRATION_ADJUSTMENT_STEPS; step += 1) {
    const factor = (low + high) / 2;
    const candidate = scaleResiduals(baseResiduals, factor, minimums);
    const coverage = currentCoverage(candidate);

    if (coverage !== null && Math.abs(coverage - target) < bestDistance) {
      bestDistance = Math.abs(coverage - target);
      bestResiduals = candidate;
    }

    if (isWithinCoverageTolerance(coverage, target)) {
      return candidate;
    }

    if (coverage === null || coverage < target) {
      low = factor;
    } else {
      high = factor;
    }
  }

  return bestResiduals;
}

function buildEmptyCalibration(horizon) {
  return {
    residual80: Array(horizon).fill(1),
    residual95: Array(horizon).fill(2),
    calibration: {
      coverage80: null,
      coverage95: null,
      target80WithinTolerance: null,
      target95WithinTolerance: null,
      sampleCount: 0,
      avgWidth80: null,
      avgWidth95: null,
      horizonWidths: Array.from({ length: horizon }, (_value, index) => ({
        horizonMonth: index + 1,
        width80: 0,
        width95: 0,
        sampleCount: 0
      }))
    }
  };
}

function buildCalibration(values, horizon, method, preferredMethod, fallbackScale = 0) {
  const residualsByHorizon = Array.from({ length: horizon }, () => []);
  const maxHoldoutOrigins = Math.min(12, Math.max(0, values.length - MIN_CALIBRATION_HISTORY_POINTS));
  const firstOrigin = values.length - maxHoldoutOrigins;

  for (let origin = firstOrigin; origin < values.length; origin += 1) {
    const train = values.slice(0, origin);
    const actuals = values.slice(origin, Math.min(values.length, origin + horizon));

    if (train.length < MIN_CALIBRATION_HISTORY_POINTS || actuals.length === 0) {
      continue;
    }

    const forecast = forecastByMethod(train, actuals.length, method, preferredMethod);
    actuals.forEach((actual, index) => {
      residualsByHorizon[index].push(Math.abs(actual - forecast[index]));
    });
  }

  let residual80 = residualsByHorizon.map((residuals) => quantile(residuals, 0.8));
  let residual95 = residualsByHorizon.map((residuals) => quantile(residuals, 0.95));
  const fallbackResidual = Math.max(1, fallbackScale);

  residual80 = residual80.map((value) => (value > 0 ? value : fallbackResidual));
  residual95 = residual95.map((value, index) => Math.max(value > 0 ? value : fallbackResidual * 1.5, residual80[index]));
  residual80 = enforceNonDecreasing(residual80);
  residual95 = enforceNonDecreasing(residual95);
  residual80 = chooseAdjustedResiduals(residualsByHorizon, residual80, 80, "coverage80");
  residual95 = chooseAdjustedResiduals(residualsByHorizon, residual95, 95, "coverage95", residual80);
  residual95 = scaleResiduals(residual95, 1, residual80);
  const coverage = calculateCoverage(residualsByHorizon, residual80, residual95);

  const horizonWidths = residual80.map((_value, index) => ({
    horizonMonth: index + 1,
    width80: Number((residual80[index] * 2).toFixed(2)),
    width95: Number((residual95[index] * 2).toFixed(2)),
    sampleCount: residualsByHorizon[index].length
  }));

  return {
    residual80,
    residual95,
    calibration: {
      coverage80: coverage.coverage80,
      coverage95: coverage.coverage95,
      target80WithinTolerance: isWithinCoverageTolerance(coverage.coverage80, 80),
      target95WithinTolerance: isWithinCoverageTolerance(coverage.coverage95, 95),
      sampleCount: coverage.sampleCount,
      avgWidth80: Number(mean(horizonWidths.map((item) => item.width80)).toFixed(2)),
      avgWidth95: Number(mean(horizonWidths.map((item) => item.width95)).toFixed(2)),
      horizonWidths
    }
  };
}

function buildForecastPoints(forecast, horizon, calibration) {
  return forecast.map((units, index) => {
    const residual80 = calibration.residual80[index] ?? 0;
    const residual95 = calibration.residual95[index] ?? residual80;

    return {
      units,
      lower80: Math.min(units, Math.max(0, units - residual80)),
      upper80: Math.max(units, units + residual80),
      lower95: Math.min(units, Math.max(0, units - residual95)),
      upper95: Math.max(units, units + residual95)
    };
  });
}

function aggregateSeries(baseSeries, level) {
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
        method: "aggregated-from-service-centers",
        validation: {
          mae: null,
          rmse: null,
          mape: null
        },
        forecast: series.forecast.map((point) => ({
          month: point.month,
          units: 0,
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
      aggregate.forecast[index].lower80 += point.lower80;
      aggregate.forecast[index].upper80 += point.upper80;
      aggregate.forecast[index].lower95 += point.lower95;
      aggregate.forecast[index].upper95 += point.upper95;
    });
  }

  return [...grouped.values()];
}

function rowsToSeries(rows, options) {
  const months = [...new Set(rows.map((row) => row.month).filter(Boolean))].sort();
  if (months.length === 0) {
    return [];
  }

  const allMonths = buildMonthRange(months[0], months[months.length - 1]);
  const groups = new Map();

  for (const row of rows) {
    const key = options.buildKey(row);
    if (!groups.has(key)) {
      groups.set(key, {
        ...options.buildIdentity(row),
        valuesByMonth: new Map()
      });
    }

    groups.get(key).valuesByMonth.set(row.month, Number(row.units));
  }

  return [...groups.values()].map((group) => ({
    ...group,
    history: allMonths.map((month) => ({
      month,
      units: group.valuesByMonth.get(month) ?? 0
    }))
  }));
}

async function fetchPartsRows({ partId, partCategory, modelId, variantId, historyEndMonth } = {}, db = pool) {
  const values = [];
  const conditions = [
    "sc.is_active = TRUE",
    "sp.is_active = TRUE"
  ];

  if (partId) {
    values.push(partId);
    conditions.push(`msd.part_id = $${values.length}`);
  }

  if (partCategory) {
    values.push(partCategory);
    conditions.push(`sp.part_category = $${values.length}`);
  }

  if (modelId) {
    values.push(modelId);
    conditions.push(`msd.model_id = $${values.length}`);
  }

  if (variantId) {
    values.push(variantId);
    conditions.push(`msd.variant_id = $${values.length}`);
  }

  if (historyEndMonth) {
    values.push(historyEndMonth);
    conditions.push(`msd.month <= $${values.length}::DATE`);
  }

  const result = await db.query(
    `
      SELECT
        sc.service_center_id,
        sc.service_center_name,
        sc.state,
        sc.region,
        sp.part_id,
        sp.part_category,
        msd.model_id,
        msd.variant_id,
        TO_CHAR(msd.month, 'YYYY-MM-01') AS month,
        SUM(msd.quantity_demanded)::INTEGER AS units
      FROM monthly_service_parts_demand msd
      JOIN service_centers sc ON sc.service_center_id = msd.service_center_id
      JOIN service_parts sp ON sp.part_id = msd.part_id
      WHERE ${conditions.join(" AND ")}
      GROUP BY sc.service_center_id, sc.service_center_name, sc.state, sc.region, sp.part_id, sp.part_category, msd.model_id, msd.variant_id, msd.month
      ORDER BY sc.service_center_id, sp.part_id, msd.month
    `,
    values
  );

  return result.rows;
}

async function fetchServiceRows({ serviceType, jobCategory, modelId, variantId, historyEndMonth } = {}, db = pool) {
  const values = [];
  const conditions = ["sc.is_active = TRUE"];

  if (serviceType) {
    values.push(serviceType);
    conditions.push(`mov.service_type = $${values.length}`);
  }

  if (jobCategory) {
    values.push(jobCategory);
    conditions.push(`mov.job_category = $${values.length}`);
  }

  if (modelId) {
    values.push(modelId);
    conditions.push(`mov.model_id = $${values.length}`);
  }

  if (variantId) {
    values.push(variantId);
    conditions.push(`mov.variant_id = $${values.length}`);
  }

  if (historyEndMonth) {
    values.push(historyEndMonth);
    conditions.push(`mov.month <= $${values.length}::DATE`);
  }

  const result = await db.query(
    `
      SELECT
        sc.service_center_id,
        sc.service_center_name,
        sc.state,
        sc.region,
        mov.service_type,
        mov.job_category,
        mov.model_id,
        mov.variant_id,
        TO_CHAR(mov.month, 'YYYY-MM-01') AS month,
        SUM(mov.order_count)::INTEGER AS units
      FROM monthly_service_order_volume mov
      JOIN service_centers sc ON sc.service_center_id = mov.service_center_id
      WHERE ${conditions.join(" AND ")}
      GROUP BY sc.service_center_id, sc.service_center_name, sc.state, sc.region, mov.service_type, mov.job_category, mov.model_id, mov.variant_id, mov.month
      ORDER BY sc.service_center_id, mov.service_type, mov.job_category, mov.month
    `,
    values
  );

  return result.rows;
}

async function fetchSlaRows({ serviceType, jobCategory, modelId, variantId, historyEndMonth } = {}, db = pool) {
  const values = [];
  const conditions = ["sc.is_active = TRUE"];
  const includeModel = Boolean(modelId || variantId);

  if (serviceType) {
    values.push(serviceType);
    conditions.push(`msp.service_type = $${values.length}`);
  }

  if (jobCategory) {
    values.push(jobCategory);
    conditions.push(`msp.job_category = $${values.length}`);
  }

  if (modelId) {
    values.push(modelId);
    conditions.push(`msp.model_id = $${values.length}`);
  }

  if (variantId) {
    values.push(variantId);
    conditions.push(`msp.variant_id = $${values.length}`);
  }

  if (historyEndMonth) {
    values.push(historyEndMonth);
    conditions.push(`msp.month <= $${values.length}::DATE`);
  }

  const result = await db.query(
    `
      SELECT
        sc.service_center_id,
        sc.service_center_name,
        sc.state,
        sc.region,
        msp.service_type,
        msp.job_category,
        ${includeModel ? "msp.model_id" : "NULL::VARCHAR AS model_id"},
        ${includeModel ? "msp.variant_id" : "NULL::VARCHAR AS variant_id"},
        TO_CHAR(msp.month, 'YYYY-MM-01') AS month,
        SUM(msp.breached_orders)::INTEGER AS units
      FROM monthly_sla_performance msp
      JOIN service_centers sc ON sc.service_center_id = msp.service_center_id
      WHERE ${conditions.join(" AND ")}
      GROUP BY sc.service_center_id, sc.service_center_name, sc.state, sc.region, msp.service_type, msp.job_category, ${includeModel ? "msp.model_id, msp.variant_id," : ""} msp.month
      ORDER BY sc.service_center_id, msp.service_type, msp.job_category, msp.month
    `,
    values
  );

  return result.rows;
}

function scoreSlaRisk(point, series) {
  // Keep the first SLA release explainable: expected breaches drive the score,
  // while wide intervals and weaker validation lift the risk level.
  const expectedBreaches = Math.max(0, point.units || 0);
  const intervalWidth = Math.max(0, (point.upper95 ?? expectedBreaches) - (point.lower95 ?? expectedBreaches));
  const uncertaintyRatio = expectedBreaches > 0 ? intervalWidth / expectedBreaches : intervalWidth > 0 ? 1 : 0;
  const validationMape = Number(series.validation?.mape ?? 0);
  const riskScore = clamp((expectedBreaches * 6) + (uncertaintyRatio * 18) + (validationMape * 0.35), 0, 100);

  return {
    expectedBreaches: roundUnits(expectedBreaches),
    breachProbability: Number(clamp(expectedBreaches / 100, 0, 1).toFixed(4)),
    riskScore: Number(riskScore.toFixed(2)),
    riskLevel: riskScore >= 75 ? "Critical" : riskScore >= 50 ? "High" : riskScore >= 25 ? "Medium" : "Low"
  };
}

function enrichSlaRiskSeries(series) {
  return series.map((item) => ({
    ...item,
    method: `${item.method} + SLA-risk-score`,
    forecast: item.forecast.map((point) => ({
      ...point,
      ...scoreSlaRisk(point, item)
    }))
  }));
}

function buildForecastForBaseSeries(baseSeries, horizon, preferredMethod) {
  return baseSeries.map((series) => {
    const values = series.history.map((point) => point.units);
    const fitted = fitSeries(values, horizon, preferredMethod);
    const lastMonth = series.history[series.history.length - 1]?.month;
    const seasonalForecast = applyMonthlySeasonality(fitted.intervalForecast, series.history, lastMonth);

    return {
      ...series,
      level: "service_center",
      groupId: series.serviceCenterId,
      groupLabel: series.serviceCenterName,
      method: seasonalForecast.applied ? `${fitted.method} + seasonal-index` : fitted.method,
      calibration: fitted.calibration,
      validation: fitted.validation,
      forecast: seasonalForecast.forecast.map((point, index) => ({
        month: addMonths(lastMonth, index + 1),
        ...point
      }))
    };
  });
}

async function fetchWarrantyRows({ claimType, returnReason, ageBucket, modelId, variantId, historyEndMonth } = {}, db = pool) {
  const values = [];
  const conditions = ["sc.is_active = TRUE"];

  if (claimType) {
    values.push(claimType);
    conditions.push(`mwv.claim_type = $${values.length}`);
  }

  if (returnReason) {
    values.push(returnReason);
    conditions.push(`mwv.return_reason = $${values.length}`);
  }

  if (ageBucket) {
    values.push(ageBucket);
    conditions.push(`mwv.age_bucket = $${values.length}`);
  }

  if (modelId) {
    values.push(modelId);
    conditions.push(`mwv.model_id = $${values.length}`);
  }

  if (variantId) {
    values.push(variantId);
    conditions.push(`mwv.variant_id = $${values.length}`);
  }

  if (historyEndMonth) {
    values.push(historyEndMonth);
    conditions.push(`mwv.month <= $${values.length}::DATE`);
  }

  const result = await db.query(
    `
      SELECT
        sc.service_center_id,
        sc.service_center_name,
        sc.state,
        sc.region,
        mwv.claim_type,
        mwv.return_reason,
        mwv.age_bucket,
        mwv.model_id,
        mwv.variant_id,
        TO_CHAR(mwv.month, 'YYYY-MM-01') AS month,
        SUM(mwv.claim_count + mwv.return_count)::INTEGER AS units
      FROM monthly_warranty_return_volume mwv
      JOIN service_centers sc ON sc.service_center_id = mwv.service_center_id
      WHERE ${conditions.join(" AND ")}
      GROUP BY sc.service_center_id, sc.service_center_name, sc.state, sc.region, mwv.claim_type, mwv.return_reason, mwv.age_bucket, mwv.model_id, mwv.variant_id, mwv.month
      ORDER BY sc.service_center_id, mwv.claim_type, mwv.return_reason, mwv.age_bucket, mwv.month
    `,
    values
  );

  return result.rows;
}

export async function buildPartsDemandForecast({ horizon, scope = {}, db = pool } = {}) {
  const safeHorizon = clampHorizon(horizon);
  const rows = await fetchPartsRows(scope, db);
  const baseSeries = rowsToSeries(rows, {
    buildKey: (row) => [row.service_center_id, row.part_id, row.model_id ?? "", row.variant_id ?? ""].join("|"),
    buildIdentity: (row) => ({
      serviceCenterId: row.service_center_id,
      serviceCenterName: row.service_center_name,
      state: row.state,
      zone: row.region,
      partId: row.part_id,
      partCategory: row.part_category,
      modelId: row.model_id,
      variantId: row.variant_id
    })
  });
  const serviceCenterSeries = buildForecastForBaseSeries(baseSeries, safeHorizon, "croston");

  return {
    horizon: safeHorizon,
    scope,
    levels: [
      {
        level: "service_center",
        series: serviceCenterSeries
      },
      {
        level: "state",
        series: aggregateSeries(serviceCenterSeries, "state")
      },
      {
        level: "zone",
        series: aggregateSeries(serviceCenterSeries, "zone")
      }
    ]
  };
}

export async function buildServiceOrderForecast({ horizon, scope = {}, db = pool } = {}) {
  const safeHorizon = clampHorizon(horizon);
  const rows = await fetchServiceRows(scope, db);
  const baseSeries = rowsToSeries(rows, {
    buildKey: (row) => [row.service_center_id, row.service_type ?? "", row.job_category ?? "", row.model_id ?? "", row.variant_id ?? ""].join("|"),
    buildIdentity: (row) => ({
      serviceCenterId: row.service_center_id,
      serviceCenterName: row.service_center_name,
      state: row.state,
      zone: row.region,
      serviceType: row.service_type,
      jobCategory: row.job_category,
      modelId: row.model_id,
      variantId: row.variant_id
    })
  });
  const serviceCenterSeries = buildForecastForBaseSeries(baseSeries, safeHorizon, "moving-average");

  return {
    horizon: safeHorizon,
    scope,
    levels: [
      {
        level: "service_center",
        series: serviceCenterSeries
      },
      {
        level: "state",
        series: aggregateSeries(serviceCenterSeries, "state")
      },
      {
        level: "zone",
        series: aggregateSeries(serviceCenterSeries, "zone")
      }
    ]
  };
}

export async function buildSlaBreachRiskForecast({ horizon, scope = {}, db = pool } = {}) {
  const safeHorizon = clampHorizon(horizon);
  const rows = await fetchSlaRows(scope, db);
  const baseSeries = rowsToSeries(rows, {
    buildKey: (row) => [row.service_center_id, row.service_type ?? "", row.job_category ?? "", row.model_id ?? "", row.variant_id ?? ""].join("|"),
    buildIdentity: (row) => ({
      serviceCenterId: row.service_center_id,
      serviceCenterName: row.service_center_name,
      state: row.state,
      zone: row.region,
      serviceType: row.service_type,
      jobCategory: row.job_category,
      modelId: row.model_id,
      variantId: row.variant_id
    })
  });
  const serviceCenterSeries = enrichSlaRiskSeries(buildForecastForBaseSeries(baseSeries, safeHorizon, "moving-average"));

  return {
    horizon: safeHorizon,
    scope,
    levels: [
      {
        level: "service_center",
        series: serviceCenterSeries
      },
      {
        level: "state",
        series: enrichSlaRiskSeries(aggregateSeries(serviceCenterSeries, "state"))
      },
      {
        level: "zone",
        series: enrichSlaRiskSeries(aggregateSeries(serviceCenterSeries, "zone"))
      }
    ]
  };
}

export async function buildWarrantyReturnsForecast({ horizon, scope = {}, db = pool } = {}) {
  const safeHorizon = clampHorizon(horizon);
  const rows = await fetchWarrantyRows(scope, db);
  const baseSeries = rowsToSeries(rows, {
    buildKey: (row) => [row.service_center_id, row.claim_type ?? "", row.return_reason ?? "", row.age_bucket ?? "", row.model_id ?? "", row.variant_id ?? ""].join("|"),
    buildIdentity: (row) => ({
      serviceCenterId: row.service_center_id,
      serviceCenterName: row.service_center_name,
      state: row.state,
      zone: row.region,
      claimType: row.claim_type,
      returnReason: row.return_reason,
      ageBucket: row.age_bucket,
      modelId: row.model_id,
      variantId: row.variant_id
    })
  });
  const serviceCenterSeries = buildForecastForBaseSeries(baseSeries, safeHorizon, "moving-average");

  return {
    horizon: safeHorizon,
    scope,
    levels: [
      {
        level: "service_center",
        series: serviceCenterSeries
      },
      {
        level: "state",
        series: aggregateSeries(serviceCenterSeries, "state")
      },
      {
        level: "zone",
        series: aggregateSeries(serviceCenterSeries, "zone")
      }
    ]
  };
}
