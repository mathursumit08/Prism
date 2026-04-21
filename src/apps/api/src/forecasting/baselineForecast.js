import { pool } from "../db.js";

const LEVELS = {
  dealer: {
    labelKey: "dealerName"
  },
  state: {
    labelKey: "state"
  },
  zone: {
    labelKey: "zone"
  }
};

const DEFAULT_HORIZON = 6;
const MAX_HORIZON = 24;
const MIN_SERIES_LENGTH = 4;

/**
 * Normalizes a requested forecast horizon into the supported 1-24 month range.
 */
function clampHorizon(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_HORIZON;
  }

  return Math.min(Math.max(Math.trunc(parsed), 1), MAX_HORIZON);
}

/**
 * Formats a JavaScript date as the first day of its UTC month.
 */
function formatMonth(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}-01`;
}

/**
 * Adds a number of calendar months to a YYYY-MM-01 month string.
 */
function addMonths(month, offset) {
  const date = new Date(`${month}T00:00:00.000Z`);
  date.setUTCMonth(date.getUTCMonth() + offset);
  return formatMonth(date);
}

/**
 * Builds a continuous month list so missing sales months become zeroes.
 */
function buildMonthRange(startMonth, endMonth) {
  const months = [];
  let cursor = startMonth;

  while (cursor <= endMonth) {
    months.push(cursor);
    cursor = addMonths(cursor, 1);
  }

  return months;
}

/**
 * Converts model output to a non-negative whole-unit sales forecast.
 */
function roundForecast(value) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.round(value));
}

/**
 * Returns the arithmetic average for a numeric series.
 */
function mean(values) {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * Calculates holdout accuracy metrics used to choose the best baseline model.
 */
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

/**
 * Applies first-order differencing repeatedly for ARIMA-style stationarity.
 */
function difference(values, order) {
  let output = [...values];

  for (let step = 0; step < order; step += 1) {
    output = output.slice(1).map((value, index) => value - output[index]);
  }

  return output;
}

/**
 * Solves normal equations with Gaussian elimination for autoregressive fitting.
 */
function solveLinearSystem(matrix, vector) {
  const size = vector.length;
  const augmented = matrix.map((row, index) => [...row, vector[index]]);

  for (let pivot = 0; pivot < size; pivot += 1) {
    let bestRow = pivot;

    for (let row = pivot + 1; row < size; row += 1) {
      if (Math.abs(augmented[row][pivot]) > Math.abs(augmented[bestRow][pivot])) {
        bestRow = row;
      }
    }

    if (Math.abs(augmented[bestRow][pivot]) < 1e-9) {
      return null;
    }

    [augmented[pivot], augmented[bestRow]] = [augmented[bestRow], augmented[pivot]];

    const pivotValue = augmented[pivot][pivot];
    for (let column = pivot; column <= size; column += 1) {
      augmented[pivot][column] /= pivotValue;
    }

    for (let row = 0; row < size; row += 1) {
      if (row === pivot) {
        continue;
      }

      const factor = augmented[row][pivot];
      for (let column = pivot; column <= size; column += 1) {
        augmented[row][column] -= factor * augmented[pivot][column];
      }
    }
  }

  return augmented.map((row) => row[size]);
}

/**
 * Fits an autoregressive model with an intercept and the requested lag count.
 */
function fitAutoRegression(values, lagCount) {
  if (lagCount === 0) {
    return {
      coefficients: [mean(values)],
      lagCount
    };
  }

  if (values.length <= lagCount) {
    return null;
  }

  const featureCount = lagCount + 1;
  const xtx = Array.from({ length: featureCount }, () => Array(featureCount).fill(0));
  const xty = Array(featureCount).fill(0);

  for (let index = lagCount; index < values.length; index += 1) {
    const features = [1];
    for (let lag = 1; lag <= lagCount; lag += 1) {
      features.push(values[index - lag]);
    }

    for (let row = 0; row < featureCount; row += 1) {
      xty[row] += features[row] * values[index];
      for (let column = 0; column < featureCount; column += 1) {
        xtx[row][column] += features[row] * features[column];
      }
    }
  }

  const coefficients = solveLinearSystem(xtx, xty);
  if (!coefficients) {
    return null;
  }

  return {
    coefficients,
    lagCount
  };
}

/**
 * Converts differenced ARIMA forecasts back to original sales-unit scale.
 */
function integrateForecast(originalValues, differencedForecasts, order) {
  if (order === 0) {
    return differencedForecasts;
  }

  let previousLevel = originalValues[originalValues.length - 1] ?? 0;

  return differencedForecasts.map((forecast) => {
    previousLevel += forecast;
    return previousLevel;
  });
}

/**
 * Produces ARIMA(p,d,0) forecasts using differencing plus autoregression.
 */
function forecastArima(values, horizon, { p, d }) {
  const transformed = difference(values, d);

  if (transformed.length < Math.max(p + 2, 2)) {
    return null;
  }

  const model = fitAutoRegression(transformed, p);
  if (!model) {
    return null;
  }

  const history = [...transformed];
  const forecasts = [];

  for (let step = 0; step < horizon; step += 1) {
    let next = model.coefficients[0];

    for (let lag = 1; lag <= model.lagCount; lag += 1) {
      next += model.coefficients[lag] * history[history.length - lag];
    }

    if (!Number.isFinite(next)) {
      return null;
    }

    history.push(next);
    forecasts.push(next);
  }

  return integrateForecast(values, forecasts, d).map(roundForecast);
}

/**
 * Produces simple exponential smoothing forecasts with no trend or seasonality.
 */
function forecastEtsSimple(values, horizon, alpha) {
  let level = values[0];

  for (let index = 1; index < values.length; index += 1) {
    level = alpha * values[index] + (1 - alpha) * level;
  }

  return Array(horizon).fill(roundForecast(level));
}

/**
 * Produces Holt ETS forecasts with additive level and additive trend.
 */
function forecastEtsHolt(values, horizon, alpha, beta) {
  let level = values[0];
  let trend = values.length > 1 ? values[1] - values[0] : 0;

  for (let index = 1; index < values.length; index += 1) {
    const previousLevel = level;
    level = alpha * values[index] + (1 - alpha) * (level + trend);
    trend = beta * (level - previousLevel) + (1 - beta) * trend;
  }

  return Array.from({ length: horizon }, (_value, index) => roundForecast(level + (index + 1) * trend));
}

/**
 * Estimates initial monthly seasonal effects for additive seasonal ETS.
 */
function initialSeasonals(values, seasonLength) {
  const seasonCount = Math.floor(values.length / seasonLength);
  if (seasonCount < 2) {
    return null;
  }

  const seasonAverages = Array.from({ length: seasonCount }, (_value, seasonIndex) =>
    mean(values.slice(seasonIndex * seasonLength, (seasonIndex + 1) * seasonLength))
  );

  return Array.from({ length: seasonLength }, (_value, seasonIndex) => {
    let total = 0;
    for (let season = 0; season < seasonCount; season += 1) {
      total += values[season * seasonLength + seasonIndex] - seasonAverages[season];
    }
    return total / seasonCount;
  });
}

/**
 * Produces additive Holt-Winters ETS forecasts when two seasons are available.
 */
function forecastEtsAdditiveSeasonal(values, horizon, alpha, beta, gamma, seasonLength = 12) {
  if (values.length < seasonLength * 2) {
    return null;
  }

  const seasonals = initialSeasonals(values, seasonLength);
  if (!seasonals) {
    return null;
  }

  let level = mean(values.slice(0, seasonLength));
  let trend = (mean(values.slice(seasonLength, seasonLength * 2)) - level) / seasonLength;

  for (let index = 0; index < values.length; index += 1) {
    const seasonalIndex = index % seasonLength;
    const previousLevel = level;
    const seasonal = seasonals[seasonalIndex];
    level = alpha * (values[index] - seasonal) + (1 - alpha) * (level + trend);
    trend = beta * (level - previousLevel) + (1 - beta) * trend;
    seasonals[seasonalIndex] = gamma * (values[index] - level) + (1 - gamma) * seasonal;
  }

  return Array.from({ length: horizon }, (_value, index) => {
    const seasonal = seasonals[(values.length + index) % seasonLength];
    return roundForecast(level + (index + 1) * trend + seasonal);
  });
}

/**
 * Dispatches to the selected ETS variant from a compact options object.
 */
function forecastEts(values, horizon, options) {
  if (options.type === "simple") {
    return forecastEtsSimple(values, horizon, options.alpha);
  }

  if (options.type === "holt") {
    return forecastEtsHolt(values, horizon, options.alpha, options.beta);
  }

  return forecastEtsAdditiveSeasonal(values, horizon, options.alpha, options.beta, options.gamma);
}

/**
 * Builds the ARIMA and ETS model candidate set evaluated for each series.
 */
function candidateForecasts(values, horizon) {
  const candidates = [];
  const arimaOrders = [
    { p: 0, d: 0 },
    { p: 1, d: 0 },
    { p: 2, d: 0 },
    { p: 0, d: 1 },
    { p: 1, d: 1 },
    { p: 2, d: 1 }
  ];

  for (const order of arimaOrders) {
    const forecast = forecastArima(values, horizon, order);
    if (forecast) {
      candidates.push({
        method: `ARIMA(${order.p},${order.d},0)`,
        forecast
      });
    }
  }

  const smoothingValues = [0.2, 0.4, 0.6, 0.8];
  for (const alpha of smoothingValues) {
    candidates.push({
      method: `ETS(A,N,N) alpha=${alpha}`,
      forecast: forecastEts(values, horizon, { type: "simple", alpha })
    });

    for (const beta of [0.2, 0.4, 0.6]) {
      candidates.push({
        method: `ETS(A,A,N) alpha=${alpha} beta=${beta}`,
        forecast: forecastEts(values, horizon, { type: "holt", alpha, beta })
      });
    }
  }

  for (const alpha of [0.3, 0.6]) {
    for (const beta of [0.2, 0.4]) {
      for (const gamma of [0.2, 0.4]) {
        const forecast = forecastEts(values, horizon, {
          type: "seasonal",
          alpha,
          beta,
          gamma
        });

        if (forecast) {
          candidates.push({
            method: `ETS(A,A,A) alpha=${alpha} beta=${beta} gamma=${gamma}`,
            forecast
          });
        }
      }
    }
  }

  return candidates;
}

/**
 * Returns a conservative moving-average forecast when data is too sparse.
 */
function fallbackForecast(values, horizon) {
  const window = values.slice(-Math.min(values.length, 3));
  return {
    method: "moving-average(3)",
    forecast: Array(horizon).fill(roundForecast(mean(window))),
    validation: {
      mae: null,
      rmse: null,
      mape: null
    }
  };
}

/**
 * Selects the lowest-MAE candidate on a holdout window and refits it on full history.
 */
function fitBaseline(values, horizon) {
  if (values.length < MIN_SERIES_LENGTH) {
    return fallbackForecast(values, horizon);
  }

  const validationWindow = Math.min(6, Math.max(1, Math.floor(values.length / 3)));
  const train = values.slice(0, -validationWindow);
  const actuals = values.slice(-validationWindow);

  if (train.length < MIN_SERIES_LENGTH) {
    return fallbackForecast(values, horizon);
  }

  const scored = candidateForecasts(train, validationWindow)
    .map((candidate) => ({
      ...candidate,
      validation: errors(actuals, candidate.forecast)
    }))
    .filter((candidate) => candidate.validation.mae !== null)
    .sort((left, right) => left.validation.mae - right.validation.mae);

  if (scored.length === 0) {
    return fallbackForecast(values, horizon);
  }

  const winner = scored[0];
  const refit = candidateForecasts(values, horizon).find((candidate) => candidate.method === winner.method);

  return {
    method: winner.method,
    forecast: refit?.forecast ?? fallbackForecast(values, horizon).forecast,
    validation: winner.validation
  };
}

/**
 * Reads monthly sales at dealer level together with state and zone metadata.
 */
async function fetchDealerRows(filters) {
  const conditions = [];
  const values = [];

  if (filters.modelId) {
    values.push(filters.modelId);
    conditions.push(`m.model_id = $${values.length}`);
  }

  if (filters.variantId) {
    values.push(filters.variantId);
    conditions.push(`m.variant_id = $${values.length}`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const result = await pool.query(
    `
      SELECT
        d.dealer_id,
        d.dealer_name,
        d.state,
        d.region,
        TO_CHAR(m.month, 'YYYY-MM-01') AS month,
        SUM(m.units_sold)::INTEGER AS units_sold
      FROM monthly_sales_data m
      JOIN dealers d ON d.dealer_id = m.dealer_id
      ${where}
      GROUP BY d.dealer_id, d.dealer_name, d.state, d.region, m.month
      ORDER BY d.dealer_id, m.month
    `,
    values
  );

  return result.rows;
}

/**
 * Converts dealer-level rows into complete monthly dealer series with hierarchy metadata.
 */
function buildDealerSeries(rows) {
  if (rows.length === 0) {
    return [];
  }

  const months = [...new Set(rows.map((row) => row.month))].sort();
  const allMonths = buildMonthRange(months[0], months[months.length - 1]);
  const groups = new Map();

  for (const row of rows) {
    if (!groups.has(row.dealer_id)) {
      groups.set(row.dealer_id, {
        dealerId: row.dealer_id,
        dealerName: row.dealer_name,
        state: row.state,
        zone: row.region,
        valuesByMonth: new Map()
      });
    }

    groups.get(row.dealer_id).valuesByMonth.set(row.month, Number(row.units_sold));
  }

  return [...groups.values()].map((group) => ({
    dealerId: group.dealerId,
    dealerName: group.dealerName,
    state: group.state,
    zone: group.zone,
    history: allMonths.map((month) => ({
      month,
      unitsSold: group.valuesByMonth.get(month) ?? 0
    }))
  }));
}

/**
 * Generates dealer-level forecasts that will be rolled up into state and zone totals.
 */
async function forecastDealers(horizon, filters) {
  const rows = await fetchDealerRows(filters);

  return buildDealerSeries(rows).map((series) => {
    const values = series.history.map((point) => point.unitsSold);
    const fitted = fitBaseline(values, horizon);
    const lastMonth = series.history[series.history.length - 1]?.month;

    return {
      level: "dealer",
      groupId: series.dealerId,
      groupLabel: series.dealerName,
      state: series.state,
      zone: series.zone,
      method: fitted.method,
      validation: fitted.validation,
      history: series.history,
      forecast: fitted.forecast.map((unitsSold, index) => ({
        month: addMonths(lastMonth, index + 1),
        unitsSold
      }))
    };
  });
}

/**
 * Aggregates dealer histories and dealer forecasts into a higher hierarchy level.
 */
function aggregateFromDealers(dealerSeries, level) {
  const grouped = new Map();

  for (const dealer of dealerSeries) {
    const groupId = level === "state" ? dealer.state : dealer.zone;

    if (!grouped.has(groupId)) {
      grouped.set(groupId, {
        level,
        groupId,
        groupLabel: groupId,
        method: "aggregated-from-dealers",
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
          unitsSold: 0
        }))
      });
    }

    const aggregate = grouped.get(groupId);

    dealer.history.forEach((point, index) => {
      aggregate.history[index].unitsSold += point.unitsSold;
    });

    dealer.forecast.forEach((point, index) => {
      aggregate.forecast[index].unitsSold += point.unitsSold;
    });
  }

  return [...grouped.values()];
}

/**
 * Public entry point for producing dealerwise, statewise, zonewise, or all forecasts.
 */
export async function buildBaselineForecast({ level = "all", horizon, modelId, variantId } = {}) {
  const safeHorizon = clampHorizon(horizon);
  const requestedLevels = level === "all" ? Object.keys(LEVELS) : [level];

  for (const requestedLevel of requestedLevels) {
    if (!LEVELS[requestedLevel]) {
      throw new Error(`Unsupported forecast level "${requestedLevel}"`);
    }
  }

  const filters = {
    modelId,
    variantId
  };

  const dealerSeries = await forecastDealers(safeHorizon, filters);
  const levelSeries = {
    dealer: dealerSeries,
    state: aggregateFromDealers(dealerSeries, "state"),
    zone: aggregateFromDealers(dealerSeries, "zone")
  };
  const levelResults = requestedLevels.map((requestedLevel) => ({
    level: requestedLevel,
    series: levelSeries[requestedLevel]
  }));

  return {
    horizon: safeHorizon,
    filters,
    generatedAt: new Date().toISOString(),
    levels: levelResults
  };
}
