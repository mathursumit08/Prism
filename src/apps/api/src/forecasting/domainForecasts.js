import { pool } from "../db.js";

const DEFAULT_HORIZON = 6;
const MAX_HORIZON = 24;
const MIN_HISTORY_POINTS = 3;

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
    return roundUnits(units * Math.max(0.35, trendFactor));
  });
}

function fitSeries(values, horizon, preferredMethod) {
  if (values.length < MIN_HISTORY_POINTS) {
    const forecast = movingAverageForecast(values, horizon, 2);
    return {
      method: "moving-average(2)",
      forecast,
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

  return {
    method,
    forecast,
    validation: errors(actuals, holdoutForecast)
  };
}

function buildIntervalPoint(units, validation) {
  const scale = validation.rmse ?? validation.mae ?? Math.max(1, units * 0.2);
  const residual80 = Math.max(1, scale);
  const residual95 = Math.max(residual80, scale * 1.6);

  return {
    units,
    lower80: Math.min(units, roundUnits(units - residual80)),
    upper80: Math.max(units, roundUnits(units + residual80)),
    lower95: Math.min(units, roundUnits(units - residual95)),
    upper95: Math.max(units, roundUnits(units + residual95))
  };
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

function buildForecastForBaseSeries(baseSeries, horizon, preferredMethod) {
  return baseSeries.map((series) => {
    const values = series.history.map((point) => point.units);
    const fitted = fitSeries(values, horizon, preferredMethod);
    const lastMonth = series.history[series.history.length - 1]?.month;

    return {
      ...series,
      level: "service_center",
      groupId: series.serviceCenterId,
      groupLabel: series.serviceCenterName,
      method: fitted.method,
      validation: fitted.validation,
      forecast: fitted.forecast.map((units, index) => ({
        month: addMonths(lastMonth, index + 1),
        ...buildIntervalPoint(units, fitted.validation)
      }))
    };
  });
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
