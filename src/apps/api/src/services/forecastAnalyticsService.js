import { canAccessForecastLevel, getScope, isGroupAllowed } from "../auth/accessControl.js";
import { pool } from "../db.js";

const allowedLevels = new Set(["dealer", "state", "zone"]);
const allowedWindows = new Set([1, 3, 6, 12, 24]);
const defaultWindow = 6;
const maxObservationLimit = 1000;

function createHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function toNumber(value) {
  return value === null || value === undefined ? null : Number(value);
}

function round(value, decimals = 2) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) {
    return null;
  }

  return Number(Number(value).toFixed(decimals));
}

function parseLevel(query, user) {
  const level = query.level?.trim() || user.forecastLevels?.[0] || "zone";

  if (!allowedLevels.has(level)) {
    throw createHttpError(400, `Unsupported forecast level "${level}"`);
  }

  return level;
}

function parseWindow(query) {
  const window = Number(query.window ?? defaultWindow);

  if (!allowedWindows.has(window)) {
    throw createHttpError(400, `window must be one of ${[...allowedWindows].join(", ")}`);
  }

  return window;
}

function parseLimit(query) {
  const limit = Number(query.limit ?? 500);

  if (!Number.isInteger(limit) || limit < 1 || limit > maxObservationLimit) {
    throw createHttpError(400, `limit must be an integer between 1 and ${maxObservationLimit}`);
  }

  return limit;
}

async function ensureAnalyticsAccess(user, level, groupId) {
  if (!canAccessForecastLevel(user, level)) {
    throw createHttpError(403, "This role cannot access the requested forecast level");
  }

  if (!(await isGroupAllowed(user, level, groupId))) {
    throw createHttpError(403, "The requested forecast scope is outside your access");
  }
}

function appendScopeCondition(conditions, values, scope) {
  if (!scope || scope.kind === "all") {
    return;
  }

  if (scope.kind === "region") {
    values.push(scope.region);
    const parameter = `$${values.length}`;
    conditions.push(`
      EXISTS (
        SELECT 1
        FROM dealers d_scope
        WHERE (
          fd.level = 'zone'
          AND d_scope.region = fd.group_id
          AND d_scope.region = ${parameter}
        ) OR (
          fd.level = 'state'
          AND d_scope.state = fd.group_id
          AND d_scope.region = ${parameter}
        ) OR (
          fd.level = 'dealer'
          AND d_scope.dealer_id = fd.group_id
          AND d_scope.region = ${parameter}
        )
      )
    `);
    return;
  }

  if (scope.kind === "dealer") {
    values.push(scope.dealerId);
    const parameter = `$${values.length}`;
    conditions.push("fd.level = 'dealer'");
    conditions.push(`
      EXISTS (
        SELECT 1
        FROM dealers d_scope
        WHERE d_scope.dealer_id = fd.group_id
          AND d_scope.dealer_id = ${parameter}
      )
    `);
  }
}

function buildObservationQuery({ user, query, includeLimit = false }) {
  const level = parseLevel(query, user);
  const groupId = query.groupId?.trim() || null;
  const segment = query.segment?.trim() || null;
  const modelId = (query.modelId || query.ModelId)?.trim() || null;
  const variantId = (query.variantId || query.VariantId)?.trim() || null;
  const window = parseWindow(query);
  const values = [window, level];
  const conditions = [
    "fd.forecast_type = 'baseline'",
    "fd.level = $2"
  ];

  if (groupId) {
    values.push(groupId);
    conditions.push(`fd.group_id = $${values.length}`);
  }

  if (segment) {
    values.push(segment);
    conditions.push(`fd.segment = $${values.length}`);
  } else {
    conditions.push("fd.segment IS NULL");
  }

  if (modelId) {
    values.push(modelId);
    conditions.push(`fd.model_id = $${values.length}`);
  } else {
    conditions.push("fd.model_id IS NULL");
  }

  if (variantId) {
    values.push(variantId);
    conditions.push(`fd.variant_id = $${values.length}`);
  } else {
    conditions.push("fd.variant_id IS NULL");
  }

  appendScopeCondition(conditions, values, getScope(user));

  let limitClause = "";
  if (includeLimit) {
    values.push(parseLimit(query));
    limitClause = `LIMIT $${values.length}`;
  }

  return {
    filters: {
      level,
      groupId,
      segment,
      modelId,
      variantId,
      window
    },
    values,
    sql: `
      WITH latest_actual_month AS (
        SELECT MAX(month) AS max_month
        FROM monthly_sales_data
      ),
      actuals AS (
        SELECT
          'dealer'::VARCHAR AS level,
          d.dealer_id AS group_id,
          m.month,
          CASE WHEN ${segment === null ? "TRUE" : "FALSE"} THEN NULL ELSE vm.segment END AS segment,
          CASE WHEN ${modelId === null ? "TRUE" : "FALSE"} THEN NULL ELSE m.model_id END AS model_id,
          CASE WHEN ${variantId === null ? "TRUE" : "FALSE"} THEN NULL ELSE m.variant_id END AS variant_id,
          SUM(m.units_sold)::NUMERIC AS actual_units
        FROM monthly_sales_data m
        JOIN dealers d ON d.dealer_id = m.dealer_id
        JOIN vehicle_models vm ON vm.model_id = m.model_id
        CROSS JOIN latest_actual_month lam
        WHERE lam.max_month IS NOT NULL
          AND m.month >= lam.max_month - (($1::INTEGER - 1) * INTERVAL '1 month')
          AND m.month <= lam.max_month
        GROUP BY d.dealer_id, m.month, 4, 5, 6

        UNION ALL

        SELECT
          'state'::VARCHAR AS level,
          d.state AS group_id,
          m.month,
          CASE WHEN ${segment === null ? "TRUE" : "FALSE"} THEN NULL ELSE vm.segment END AS segment,
          CASE WHEN ${modelId === null ? "TRUE" : "FALSE"} THEN NULL ELSE m.model_id END AS model_id,
          CASE WHEN ${variantId === null ? "TRUE" : "FALSE"} THEN NULL ELSE m.variant_id END AS variant_id,
          SUM(m.units_sold)::NUMERIC AS actual_units
        FROM monthly_sales_data m
        JOIN dealers d ON d.dealer_id = m.dealer_id
        JOIN vehicle_models vm ON vm.model_id = m.model_id
        CROSS JOIN latest_actual_month lam
        WHERE lam.max_month IS NOT NULL
          AND m.month >= lam.max_month - (($1::INTEGER - 1) * INTERVAL '1 month')
          AND m.month <= lam.max_month
        GROUP BY d.state, m.month, 4, 5, 6

        UNION ALL

        SELECT
          'zone'::VARCHAR AS level,
          d.region AS group_id,
          m.month,
          CASE WHEN ${segment === null ? "TRUE" : "FALSE"} THEN NULL ELSE vm.segment END AS segment,
          CASE WHEN ${modelId === null ? "TRUE" : "FALSE"} THEN NULL ELSE m.model_id END AS model_id,
          CASE WHEN ${variantId === null ? "TRUE" : "FALSE"} THEN NULL ELSE m.variant_id END AS variant_id,
          SUM(m.units_sold)::NUMERIC AS actual_units
        FROM monthly_sales_data m
        JOIN dealers d ON d.dealer_id = m.dealer_id
        JOIN vehicle_models vm ON vm.model_id = m.model_id
        CROSS JOIN latest_actual_month lam
        WHERE lam.max_month IS NOT NULL
          AND m.month >= lam.max_month - (($1::INTEGER - 1) * INTERVAL '1 month')
          AND m.month <= lam.max_month
        GROUP BY d.region, m.month, 4, 5, 6
      ),
      forecast_points AS (
        SELECT
          fd.level,
          fd.group_id,
          fd.group_label,
          fd.segment,
          fd.model_id,
          fd.variant_id,
          fd.forecast_month,
          SUM(fd.forecast_units)::NUMERIC AS forecast_units,
          SUM(fd.lower_80)::NUMERIC AS lower_80,
          SUM(fd.upper_80)::NUMERIC AS upper_80,
          SUM(fd.lower_95)::NUMERIC AS lower_95,
          SUM(fd.upper_95)::NUMERIC AS upper_95,
          AVG(fd.validation_mape) AS validation_mape,
          AVG(fd.validation_rmse) AS validation_rmse,
          AVG(fd.validation_mae) AS validation_mae
        FROM forecast_data fd
        JOIN forecast_runs fr
          ON fr.run_id = fd.run_id
         AND fr.status = 'completed'
        JOIN latest_actual_month lam ON lam.max_month IS NOT NULL
        WHERE ${conditions.join(" AND ")}
          AND fd.forecast_month >= lam.max_month - (($1::INTEGER - 1) * INTERVAL '1 month')
          AND fd.forecast_month <= lam.max_month
        GROUP BY fd.level, fd.group_id, fd.group_label, fd.segment, fd.model_id, fd.variant_id, fd.forecast_month
      )
      SELECT
        f.level,
        f.group_id,
        f.group_label,
        f.segment,
        f.model_id,
        f.variant_id,
        TO_CHAR(f.forecast_month, 'YYYY-MM-01') AS month,
        f.forecast_units,
        a.actual_units,
        f.forecast_units - a.actual_units AS error,
        ABS(f.forecast_units - a.actual_units) AS absolute_error,
        CASE
          WHEN a.actual_units = 0 THEN NULL
          ELSE ((f.forecast_units - a.actual_units) / a.actual_units) * 100
        END AS percentage_error,
        CASE
          WHEN a.actual_units = 0 THEN NULL
          ELSE ABS(f.forecast_units - a.actual_units) / a.actual_units * 100
        END AS absolute_percentage_error,
        f.lower_80,
        f.upper_80,
        f.lower_95,
        f.upper_95,
        f.validation_mape,
        f.validation_rmse,
        f.validation_mae
      FROM forecast_points f
      JOIN actuals a
        ON a.level = f.level
       AND a.group_id = f.group_id
       AND a.month = f.forecast_month
       AND a.segment IS NOT DISTINCT FROM f.segment
       AND a.model_id IS NOT DISTINCT FROM f.model_id
       AND a.variant_id IS NOT DISTINCT FROM f.variant_id
      ORDER BY f.forecast_month, f.group_label, f.group_id
      ${limitClause}
    `
  };
}

function normalizeObservation(row) {
  return {
    level: row.level,
    groupId: row.group_id,
    groupLabel: row.group_label,
    segment: row.segment ?? null,
    modelId: row.model_id,
    variantId: row.variant_id,
    month: row.month,
    forecastUnits: toNumber(row.forecast_units),
    actualUnits: toNumber(row.actual_units),
    error: toNumber(row.error),
    absoluteError: toNumber(row.absolute_error),
    percentageError: toNumber(row.percentage_error),
    absolutePercentageError: toNumber(row.absolute_percentage_error),
    lower80: toNumber(row.lower_80),
    upper80: toNumber(row.upper_80),
    lower95: toNumber(row.lower_95),
    upper95: toNumber(row.upper_95),
    validationMape: toNumber(row.validation_mape),
    validationRmse: toNumber(row.validation_rmse),
    validationMae: toNumber(row.validation_mae)
  };
}

export async function getForecastMetricTrendPayload(user, query, db = pool) {
  const observationQuery = buildObservationQuery({ user, query });
  await ensureAnalyticsAccess(user, observationQuery.filters.level, observationQuery.filters.groupId);

  const result = await db.query(
    `
      WITH observations AS (${observationQuery.sql})
      SELECT
        month,
        AVG(absolute_error) AS mae,
        SQRT(AVG(error * error)) AS rmse,
        AVG(absolute_percentage_error) AS mape,
        AVG(error) AS bias,
        CASE
          WHEN AVG(actual_units) = 0 THEN NULL
          ELSE AVG(error) / AVG(actual_units) * 100
        END AS bias_pct,
        COUNT(*)::INTEGER AS sample_count
      FROM observations
      GROUP BY month
      ORDER BY month
    `,
    observationQuery.values
  );

  return {
    ok: true,
    filters: observationQuery.filters,
    trend: result.rows.map((row) => ({
      month: row.month,
      mape: round(row.mape),
      mae: round(row.mae),
      rmse: round(row.rmse),
      bias: round(row.bias),
      biasPct: round(row.bias_pct),
      sampleCount: Number(row.sample_count)
    }))
  };
}

export async function getForecastObservationPayload(user, query, db = pool) {
  const observationQuery = buildObservationQuery({ user, query, includeLimit: true });
  await ensureAnalyticsAccess(user, observationQuery.filters.level, observationQuery.filters.groupId);
  const result = await db.query(observationQuery.sql, observationQuery.values);

  return {
    ok: true,
    filters: observationQuery.filters,
    limit: parseLimit(query),
    observations: result.rows.map(normalizeObservation)
  };
}

export async function getForecastErrorHistogramPayload(user, query, db = pool) {
  const observationQuery = buildObservationQuery({ user, query });
  await ensureAnalyticsAccess(user, observationQuery.filters.level, observationQuery.filters.groupId);
  const bucketSize = Number(query.bucketSize ?? 10);

  if (!Number.isInteger(bucketSize) || bucketSize < 5 || bucketSize > 50) {
    throw createHttpError(400, "bucketSize must be an integer between 5 and 50");
  }

  const result = await db.query(
    `
      WITH observations AS (${observationQuery.sql}),
      bucketed AS (
        SELECT
          FLOOR(percentage_error / $${observationQuery.values.length + 1}) * $${observationQuery.values.length + 1} AS bucket_start
        FROM observations
        WHERE percentage_error IS NOT NULL
      )
      SELECT
        bucket_start,
        bucket_start + $${observationQuery.values.length + 1} AS bucket_end,
        COUNT(*)::INTEGER AS count
      FROM bucketed
      GROUP BY bucket_start
      ORDER BY bucket_start
    `,
    [...observationQuery.values, bucketSize]
  );

  return {
    ok: true,
    filters: observationQuery.filters,
    bucketSize,
    buckets: result.rows.map((row) => ({
      minErrorPct: round(row.bucket_start),
      maxErrorPct: round(row.bucket_end),
      count: Number(row.count)
    }))
  };
}

export async function getForecastAccuracyLeaderboardPayload(user, query, db = pool) {
  const observationQuery = buildObservationQuery({ user, query });
  await ensureAnalyticsAccess(user, observationQuery.filters.level, observationQuery.filters.groupId);
  const result = await db.query(
    `
      WITH observations AS (${observationQuery.sql})
      SELECT
        level,
        group_id,
        group_label,
        AVG(absolute_error) AS mae,
        SQRT(AVG(error * error)) AS rmse,
        AVG(absolute_percentage_error) AS mape,
        AVG(error) AS bias,
        CASE
          WHEN AVG(actual_units) = 0 THEN NULL
          ELSE AVG(error) / AVG(actual_units) * 100
        END AS bias_pct,
        COUNT(*)::INTEGER AS sample_count
      FROM observations
      GROUP BY level, group_id, group_label
      ORDER BY mape ASC NULLS LAST, sample_count DESC
    `,
    observationQuery.values
  );

  return {
    ok: true,
    filters: observationQuery.filters,
    leaderboard: result.rows.map((row, index) => ({
      rank: index + 1,
      level: row.level,
      groupId: row.group_id,
      groupLabel: row.group_label,
      mape: round(row.mape),
      mae: round(row.mae),
      rmse: round(row.rmse),
      bias: round(row.bias),
      biasPct: round(row.bias_pct),
      sampleCount: Number(row.sample_count)
    }))
  };
}

export async function getCalibrationHistoryPayload(_user, query, db = pool) {
  const limit = parseLimit({ limit: query.limit ?? 12 });
  const result = await db.query(
    `
      SELECT
        run_id,
        forecast_type,
        horizon_months,
        completed_at,
        coverage_80,
        coverage_95,
        avg_width_80,
        avg_width_95,
        calibration_sample_count
      FROM forecast_runs
      WHERE forecast_type = 'baseline'
        AND status = 'completed'
        AND completed_at IS NOT NULL
      ORDER BY completed_at DESC
      LIMIT $1
    `,
    [limit]
  );

  return {
    ok: true,
    limit,
    runs: result.rows.reverse().map((row) => ({
      runId: row.run_id,
      forecastType: row.forecast_type,
      horizonMonths: row.horizon_months,
      completedAt: row.completed_at,
      coverage80: toNumber(row.coverage_80),
      coverage95: toNumber(row.coverage_95),
      avgWidth80: toNumber(row.avg_width_80),
      avgWidth95: toNumber(row.avg_width_95),
      sampleCount: Number(row.calibration_sample_count || 0)
    }))
  };
}
