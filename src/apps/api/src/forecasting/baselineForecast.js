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
const DEFAULT_SPARSE_DEALER_THRESHOLD_MONTHS = 6;
const FALLBACK_ALERT_SHARE = 0.1;
const CALIBRATION_TOLERANCE_PERCENTAGE_POINTS = 2;
const CALIBRATION_ADJUSTMENT_STEPS = 40;

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

function parseSparseDealerThreshold() {
  const parsed = Number(process.env.FORECAST_SPARSE_DEALER_MONTH_THRESHOLD);

  if (!Number.isFinite(parsed)) {
    return DEFAULT_SPARSE_DEALER_THRESHOLD_MONTHS;
  }

  return Math.max(1, Math.trunc(parsed));
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

function roundInterval(value) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.round(value));
}

function roundCorrection(value) {
  if (!Number.isFinite(value) || value <= 0) {
    return 1;
  }

  return Number(value.toFixed(6));
}

function countNonZeroActualMonths(history) {
  return history.filter((point) => point.unitsSold > 0).length;
}

function sumUnits(history) {
  return history.reduce((sum, point) => sum + point.unitsSold, 0);
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
  const currentCoverage = (residuals) =>
    calculateCoverage(residualsByHorizon, residuals, residuals)[coverageKey];
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
  const forecast = Array(horizon).fill(roundForecast(mean(window)));
  const fallbackResidual = Math.max(1, mean(window) * 0.15);
  const residual80 = enforceNonDecreasing(Array.from({ length: horizon }, (_value, index) => fallbackResidual * (index + 1) ** 0.5));
  const residual95 = residual80.map((value) => value * 1.5);

  return {
    method: "moving-average(3)",
    forecast,
    intervalResiduals: residual80,
    calibrationResiduals95: residual95,
    calibration: buildEmptyCalibration(horizon),
    intervalForecast: buildForecastPoints(forecast, horizon, { residual80, residual95 }),
    validation: {
      mae: null,
      rmse: null,
      mape: null
    }
  };
}

function forecastByMethod(values, horizon, method) {
  if (method === "moving-average(3)") {
    return fallbackForecast(values, horizon).forecast;
  }

  return candidateForecasts(values, horizon).find((candidate) => candidate.method === method)?.forecast ?? null;
}

function buildEmptyCalibration(horizon) {
  return {
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
  };
}

function buildCalibration(values, horizon, method, fallbackScale = 0) {
  const residualsByHorizon = Array.from({ length: horizon }, () => []);
  const maxHoldoutOrigins = Math.min(12, Math.max(0, values.length - MIN_SERIES_LENGTH));
  const firstOrigin = values.length - maxHoldoutOrigins;

  for (let origin = firstOrigin; origin < values.length; origin += 1) {
    const train = values.slice(0, origin);
    const actuals = values.slice(origin, Math.min(values.length, origin + horizon));

    if (train.length < MIN_SERIES_LENGTH || actuals.length === 0) {
      continue;
    }

    const forecast = forecastByMethod(train, actuals.length, method);
    if (!forecast) {
      continue;
    }

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
  return forecast.map((unitsSold, index) => {
    const residual80 = calibration.residual80[index] ?? 0;
    const residual95 = calibration.residual95[index] ?? residual80;

    return {
      unitsSold,
      lower80: roundInterval(unitsSold - residual80),
      upper80: roundInterval(unitsSold + residual80),
      lower95: roundInterval(unitsSold - residual95),
      upper95: roundInterval(unitsSold + residual95)
    };
  });
}

function scaleForecastPoint(point, share) {
  const scaledUnits = roundForecast(point.unitsSold * share);
  const lower80 = Math.min(scaledUnits, roundInterval((point.lower80 ?? point.unitsSold) * share));
  const upper80 = Math.max(scaledUnits, roundInterval((point.upper80 ?? point.unitsSold) * share));
  const lower95 = Math.min(lower80, roundInterval((point.lower95 ?? point.unitsSold) * share));
  const upper95 = Math.max(upper80, roundInterval((point.upper95 ?? point.unitsSold) * share));

  return {
    month: point.month,
    unitsSold: scaledUnits,
    lower80,
    upper80,
    lower95,
    upper95,
    dataQuality: "fallback"
  };
}

function applyBiasCorrection(point, correction) {
  const factor = roundCorrection(correction);
  const adjustedUnits = roundForecast(point.unitsSold * factor);
  const delta = adjustedUnits - point.unitsSold;
  const lower80 = Math.min(adjustedUnits, roundInterval((point.lower80 ?? point.unitsSold) + delta));
  const upper80 = Math.max(adjustedUnits, roundInterval((point.upper80 ?? point.unitsSold) + delta));
  const lower95 = Math.min(lower80, roundInterval((point.lower95 ?? point.unitsSold) + delta));
  const upper95 = Math.max(upper80, roundInterval((point.upper95 ?? point.unitsSold) + delta));

  return {
    ...point,
    unitsSold: adjustedUnits,
    lower80,
    upper80,
    lower95,
    upper95,
    biasCorrection: factor
  };
}

function getBiasCorrection(series, biasCorrections) {
  if (!biasCorrections) {
    return 1;
  }

  return roundCorrection(
    biasCorrections.get(`dealer:${series.dealerId}`) ??
    biasCorrections.get(`zone:${series.zone}`) ??
    1
  );
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
  const forecast = refit?.forecast ?? fallbackForecast(values, horizon).forecast;
  const fallbackScale = winner.validation.rmse ?? winner.validation.mae ?? mean(values) * 0.1;
  const intervalCalibration = buildCalibration(values, horizon, winner.method, fallbackScale);

  return {
    method: winner.method,
    forecast,
    intervalResiduals: intervalCalibration.residual80,
    calibration: intervalCalibration.calibration,
    intervalForecast: buildForecastPoints(forecast, horizon, intervalCalibration),
    validation: winner.validation
  };
}

/**
 * Reads monthly sales at dealer level together with state and zone metadata.
 */
async function fetchDealerRows(filters) {
  const values = [];
  const monthlyJoinConditions = ["d.dealer_id = m.dealer_id"];

  if (filters.segment) {
    values.push(filters.segment);
    monthlyJoinConditions.push(`EXISTS (
      SELECT 1
      FROM vehicle_models vm_filter
      WHERE vm_filter.model_id = m.model_id
        AND vm_filter.segment = $${values.length}
    )`);
  }

  if (filters.modelId) {
    values.push(filters.modelId);
    monthlyJoinConditions.push(`m.model_id = $${values.length}`);
  }

  if (filters.variantId) {
    values.push(filters.variantId);
    monthlyJoinConditions.push(`m.variant_id = $${values.length}`);
  }

  if (filters.historyEndMonth) {
    values.push(filters.historyEndMonth);
    monthlyJoinConditions.push(`m.month <= $${values.length}::DATE`);
  }

  const result = await pool.query(
    `
      SELECT
        d.dealer_id,
        d.dealer_name,
        d.state,
        d.region,
        d.sales_capacity_per_month,
        TO_CHAR(m.month, 'YYYY-MM-01') AS month,
        COALESCE(SUM(m.units_sold), 0)::INTEGER AS units_sold
      FROM dealers d
      LEFT JOIN monthly_sales_data m
        ON ${monthlyJoinConditions.join(" AND ")}
      GROUP BY d.dealer_id, d.dealer_name, d.state, d.region, d.sales_capacity_per_month, m.month
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

  const months = [...new Set(rows.map((row) => row.month).filter(Boolean))].sort();

  if (months.length === 0) {
    return rows.map((row) => ({
      dealerId: row.dealer_id,
      dealerName: row.dealer_name,
      state: row.state,
      zone: row.region,
      salesCapacityPerMonth: Number(row.sales_capacity_per_month ?? 0),
      history: []
    }));
  }

  const allMonths = buildMonthRange(months[0], months[months.length - 1]);
  const groups = new Map();

  for (const row of rows) {
    if (!groups.has(row.dealer_id)) {
      groups.set(row.dealer_id, {
        dealerId: row.dealer_id,
        dealerName: row.dealer_name,
        state: row.state,
        zone: row.region,
        salesCapacityPerMonth: Number(row.sales_capacity_per_month ?? 0),
        valuesByMonth: new Map()
      });
    }

    if (row.month) {
      groups.get(row.dealer_id).valuesByMonth.set(row.month, Number(row.units_sold));
    }
  }

  return [...groups.values()].map((group) => ({
    dealerId: group.dealerId,
    dealerName: group.dealerName,
    state: group.state,
    zone: group.zone,
    salesCapacityPerMonth: group.salesCapacityPerMonth,
    history: allMonths.map((month) => ({
      month,
      unitsSold: group.valuesByMonth.get(month) ?? 0
    }))
  }));
}

function buildZoneFallbacks(dealerSeries, horizon) {
  const zones = new Map();

  for (const series of dealerSeries) {
    if (!zones.has(series.zone)) {
      zones.set(series.zone, {
        history: series.history.map((point) => ({
          month: point.month,
          unitsSold: 0
        }))
      });
    }

    const zone = zones.get(series.zone);
    series.history.forEach((point, index) => {
      zone.history[index].unitsSold += point.unitsSold;
    });
  }

  const fallbacks = new Map();

  for (const [zone, series] of zones.entries()) {
    const values = series.history.map((point) => point.unitsSold);
    const fitted = fitBaseline(values, horizon);
    const lastMonth = series.history[series.history.length - 1]?.month;

    if (!lastMonth) {
      continue;
    }

    fallbacks.set(zone, {
      method: fitted.method,
      validation: fitted.validation,
      calibration: fitted.calibration,
      forecast: (fitted.intervalForecast ?? buildForecastPoints(fitted.forecast, horizon, {
        residual80: fitted.intervalResiduals ?? Array(horizon).fill(0),
        residual95: fitted.calibrationResiduals95 ?? fitted.intervalResiduals ?? Array(horizon).fill(0)
      })).map((point, index) => ({
        month: addMonths(lastMonth, index + 1),
        ...point
      }))
    });
  }

  return fallbacks;
}

function buildFallbackShares(dealerSeries) {
  const zoneTotals = new Map();
  const zoneCapacities = new Map();
  const zoneDealerCounts = new Map();

  for (const series of dealerSeries) {
    zoneTotals.set(series.zone, (zoneTotals.get(series.zone) ?? 0) + sumUnits(series.history));
    zoneCapacities.set(
      series.zone,
      (zoneCapacities.get(series.zone) ?? 0) + Math.max(0, series.salesCapacityPerMonth)
    );
    zoneDealerCounts.set(series.zone, (zoneDealerCounts.get(series.zone) ?? 0) + 1);
  }

  return new Map(dealerSeries.map((series) => {
    const dealerTotal = sumUnits(series.history);
    const zoneTotal = zoneTotals.get(series.zone) ?? 0;

    if (dealerTotal > 0 && zoneTotal > 0) {
      return [series.dealerId, dealerTotal / zoneTotal];
    }

    const zoneCapacity = zoneCapacities.get(series.zone) ?? 0;
    if (series.salesCapacityPerMonth > 0 && zoneCapacity > 0) {
      return [series.dealerId, series.salesCapacityPerMonth / zoneCapacity];
    }

    return [series.dealerId, 1 / Math.max(zoneDealerCounts.get(series.zone) ?? 1, 1)];
  }));
}

/**
 * Generates dealer-level forecasts that will be rolled up into state and zone totals.
 */
async function forecastDealers(horizon, filters, biasCorrections) {
  const rows = await fetchDealerRows(filters);
  const sparseDealerThreshold = parseSparseDealerThreshold();
  const dealerSeries = buildDealerSeries(rows);
  const zoneFallbacks = buildZoneFallbacks(dealerSeries, horizon);
  const fallbackShares = buildFallbackShares(dealerSeries);
  let fallbackCount = 0;

  const forecasts = dealerSeries.map((series) => {
    const values = series.history.map((point) => point.unitsSold);
    const nonZeroActualMonths = countNonZeroActualMonths(series.history);
    const lastMonth = series.history[series.history.length - 1]?.month;
    const biasCorrection = getBiasCorrection(series, biasCorrections);

    if (nonZeroActualMonths < sparseDealerThreshold) {
      const zoneFallback = zoneFallbacks.get(series.zone);
      const share = fallbackShares.get(series.dealerId) ?? 0;

      if (zoneFallback) {
        fallbackCount += 1;

        return {
          level: "dealer",
          groupId: series.dealerId,
          groupLabel: series.dealerName,
          state: series.state,
          zone: series.zone,
          method: `zone-proportional-fallback(${zoneFallback.method})`,
          dataQuality: "fallback",
          biasCorrection,
          validation: {
            mae: null,
            rmse: null,
            mape: null
          },
          calibration: buildEmptyCalibration(horizon),
          history: series.history,
          forecast: zoneFallback.forecast
            .map((point) => scaleForecastPoint(point, share))
            .map((point) => applyBiasCorrection(point, biasCorrection))
        };
      }

      const fittedSparse = fitBaseline(values, horizon);
      const sparseForecastPoints = lastMonth
        ? (fittedSparse.intervalForecast ?? buildForecastPoints(fittedSparse.forecast, horizon, {
          residual80: fittedSparse.intervalResiduals ?? Array(horizon).fill(0),
          residual95: fittedSparse.calibrationResiduals95 ?? fittedSparse.intervalResiduals ?? Array(horizon).fill(0)
        })).map((point, index) => ({
          month: addMonths(lastMonth, index + 1),
          ...point,
          dataQuality: "sparse"
        })).map((point) => applyBiasCorrection(point, biasCorrection))
        : [];

      return {
        level: "dealer",
        groupId: series.dealerId,
        groupLabel: series.dealerName,
        state: series.state,
        zone: series.zone,
        method: fittedSparse.method,
        dataQuality: "sparse",
        biasCorrection,
        validation: fittedSparse.validation,
        calibration: fittedSparse.calibration,
        history: series.history,
        forecast: sparseForecastPoints
      };
    }

    const fitted = fitBaseline(values, horizon);

    return {
      level: "dealer",
      groupId: series.dealerId,
      groupLabel: series.dealerName,
      state: series.state,
      zone: series.zone,
      method: fitted.method,
      dataQuality: "rich",
      biasCorrection,
      validation: fitted.validation,
      calibration: fitted.calibration,
      history: series.history,
      forecast: (fitted.intervalForecast ?? buildForecastPoints(fitted.forecast, horizon, {
        residual80: fitted.intervalResiduals ?? Array(horizon).fill(0),
        residual95: fitted.calibrationResiduals95 ?? fitted.intervalResiduals ?? Array(horizon).fill(0)
      })).map((point, index) => ({
        month: addMonths(lastMonth, index + 1),
        ...point,
        dataQuality: "rich"
      })).map((point) => applyBiasCorrection(point, biasCorrection))
    };
  });

  if (forecasts.length > 0 && fallbackCount / forecasts.length > FALLBACK_ALERT_SHARE) {
    console.warn(
      `Sparse dealer fallback alert: ${fallbackCount}/${forecasts.length} dealers (${((fallbackCount / forecasts.length) * 100).toFixed(1)}%) used zone-level fallback`
    );
  }

  return forecasts;
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

function retargetForecastMonths(series, forecastStartMonth) {
  if (!forecastStartMonth) {
    return series;
  }

  return {
    ...series,
    forecast: series.forecast.map((point, index) => ({
      ...point,
      month: addMonths(forecastStartMonth, index)
    }))
  };
}

function summarizeBiasCorrection(points) {
  const totalUnits = points.reduce((sum, point) => sum + point.unitsSold, 0);

  if (totalUnits > 0) {
    return roundCorrection(
      points.reduce((sum, point) => sum + (point.biasCorrection ?? 1) * point.unitsSold, 0) / totalUnits
    );
  }

  return roundCorrection(mean(points.map((point) => point.biasCorrection ?? 1)));
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
      aggregate.forecast[index].lower80 += point.lower80;
      aggregate.forecast[index].upper80 += point.upper80;
      aggregate.forecast[index].lower95 += point.lower95;
      aggregate.forecast[index].upper95 += point.upper95;
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

/**
 * Public entry point for producing dealerwise, statewise, zonewise, or all forecasts.
 */
export async function buildBaselineForecast({
  level = "all",
  horizon,
  segment,
  modelId,
  variantId,
  historyEndMonth,
  forecastStartMonth,
  biasCorrections
} = {}) {
  const safeHorizon = clampHorizon(horizon);
  const requestedLevels = level === "all" ? Object.keys(LEVELS) : [level];

  for (const requestedLevel of requestedLevels) {
    if (!LEVELS[requestedLevel]) {
      throw new Error(`Unsupported forecast level "${requestedLevel}"`);
    }
  }

  const filters = {
    segment,
    modelId,
    variantId,
    historyEndMonth
  };

  const dealerSeries = (await forecastDealers(safeHorizon, filters, biasCorrections))
    .map((series) => retargetForecastMonths(series, forecastStartMonth));
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
