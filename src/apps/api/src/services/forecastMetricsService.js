import { canAccessForecastLevel, getScope, isGroupAllowed } from "../auth/accessControl.js";
import { pool } from "../db.js";

const allowedLevels = new Set(["dealer", "state", "zone"]);
const allowedWindows = new Set([1, 3, 6]);

function createHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function toNumber(value) {
  return value === null || value === undefined ? null : Number(value);
}

function parseWindow(value) {
  const windowMonths = Number(value ?? 6);

  if (!allowedWindows.has(windowMonths)) {
    throw createHttpError(400, "window must be one of 1, 3, or 6");
  }

  return windowMonths;
}

async function ensureMetricsAccess(user, level, groupId) {
  if (level && !canAccessForecastLevel(user, level)) {
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

export async function getForecastMetricsPayload(user, query, db = pool) {
  const level = query.level?.trim() || null;
  const groupId = query.groupId?.trim() || null;
  const segment = query.segment?.trim() || null;
  const modelId = (query.modelId || query.ModelId)?.trim() || null;
  const variantId = (query.variantId || query.VariantId)?.trim() || null;
  const window = parseWindow(query.window);

  if (level && !allowedLevels.has(level)) {
    throw createHttpError(400, `Unsupported forecast level "${level}"`);
  }

  await ensureMetricsAccess(user, level || "zone", groupId);

  const values = [window];
  const conditions = ["fd.forecast_type = 'baseline'"];

  if (level) {
    values.push(level);
    conditions.push(`fd.level = $${values.length}`);
  }

  if (groupId) {
    values.push(groupId);
    conditions.push(`fd.group_id = $${values.length}`);
  }

  if (segment) {
    values.push(segment);
    conditions.push(`fd.segment = $${values.length}`);
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

  const result = await db.query(
    `
      WITH latest_actual_month AS (
        SELECT MAX(month) AS max_month
        FROM monthly_sales_data
      ),
      actuals AS (
        SELECT
          'dealer'::VARCHAR AS level,
          d.dealer_id AS group_id,
          m.month,
          CASE WHEN $${values.length + 1}::VARCHAR IS NULL THEN NULL ELSE vm.segment END AS segment,
          CASE WHEN $${values.length + 2}::VARCHAR IS NULL THEN NULL ELSE m.model_id END AS model_id,
          CASE WHEN $${values.length + 3}::VARCHAR IS NULL THEN NULL ELSE m.variant_id END AS variant_id,
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
          CASE WHEN $${values.length + 1}::VARCHAR IS NULL THEN NULL ELSE vm.segment END AS segment,
          CASE WHEN $${values.length + 2}::VARCHAR IS NULL THEN NULL ELSE m.model_id END AS model_id,
          CASE WHEN $${values.length + 3}::VARCHAR IS NULL THEN NULL ELSE m.variant_id END AS variant_id,
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
          CASE WHEN $${values.length + 1}::VARCHAR IS NULL THEN NULL ELSE vm.segment END AS segment,
          CASE WHEN $${values.length + 2}::VARCHAR IS NULL THEN NULL ELSE m.model_id END AS model_id,
          CASE WHEN $${values.length + 3}::VARCHAR IS NULL THEN NULL ELSE m.variant_id END AS variant_id,
          SUM(m.units_sold)::NUMERIC AS actual_units
        FROM monthly_sales_data m
        JOIN dealers d ON d.dealer_id = m.dealer_id
        JOIN vehicle_models vm ON vm.model_id = m.model_id
        CROSS JOIN latest_actual_month lam
        WHERE lam.max_month IS NOT NULL
          AND m.month >= lam.max_month - (($1::INTEGER - 1) * INTERVAL '1 month')
          AND m.month <= lam.max_month
        GROUP BY d.region, m.month, 4, 5, 6
      )
      SELECT
        fd.level,
        fd.group_id,
        fd.group_label,
        fd.segment,
        fd.model_id,
        fd.variant_id,
        AVG(fd.validation_mape) AS avg_mape,
        AVG(fd.validation_rmse) AS avg_rmse,
        AVG(fd.validation_mae) AS avg_mae,
        AVG(fd.forecast_units - a.actual_units) AS bias,
        AVG(fd.bias_correction) AS avg_bias_correction,
        COUNT(*)::INTEGER AS sample_count
      FROM forecast_data fd
      JOIN forecast_runs fr
        ON fr.run_id = fd.run_id
       AND fr.status = 'completed'
      JOIN actuals a
        ON a.level = fd.level
       AND a.group_id = fd.group_id
       AND a.month = fd.forecast_month
       AND a.segment IS NOT DISTINCT FROM fd.segment
       AND a.model_id IS NOT DISTINCT FROM fd.model_id
       AND a.variant_id IS NOT DISTINCT FROM fd.variant_id
      WHERE ${conditions.join(" AND ")}
      GROUP BY fd.level, fd.group_id, fd.group_label, fd.segment, fd.model_id, fd.variant_id
      ORDER BY fd.level, fd.group_label, fd.group_id
    `,
    [...values, segment, modelId, variantId]
  );

  return {
    ok: true,
    window,
    filters: {
      level: level || null,
      groupId: groupId || null,
      segment: segment || null,
      modelId,
      variantId
    },
    metrics: result.rows.map((row) => ({
      level: row.level,
      groupId: row.group_id,
      groupLabel: row.group_label,
      segment: row.segment ?? null,
      modelId: row.model_id,
      variantId: row.variant_id,
      avgMape: toNumber(row.avg_mape),
      avgRmse: toNumber(row.avg_rmse),
      avgMae: toNumber(row.avg_mae),
      bias: toNumber(row.bias),
      biasCorrection: toNumber(row.avg_bias_correction),
      sampleCount: Number(row.sample_count)
    }))
  };
}
