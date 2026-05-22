import { getScope } from "../auth/accessControl.js";
import { ForecastRun } from "../data/models/index.js";
import { pool } from "../db.js";

const domainConfigs = {
  parts: {
    forecastDomain: "Parts",
    forecastType: "demand",
    tableName: "parts_forecast_data",
    unitColumn: "forecast_units",
    dimensionColumns: {
      partId: "part_id",
      partCategory: "part_category",
      modelId: "model_id",
      variantId: "variant_id"
    }
  },
  service: {
    forecastDomain: "Service",
    forecastType: "order_volume",
    tableName: "service_forecast_data",
    unitColumn: "forecast_orders",
    dimensionColumns: {
      serviceType: "service_type",
      jobCategory: "job_category",
      modelId: "model_id",
      variantId: "variant_id"
    }
  }
};

const allowedLevels = new Set(["service_center", "state", "zone"]);
const allowedWindows = new Set([1, 3, 6, 12, 24]);
const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;

function createHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function getDomainConfig(domain) {
  const config = domainConfigs[domain];
  if (!config) {
    throw createHttpError(404, "Unsupported forecast domain");
  }

  return config;
}

function parseOptionalDate(value, fieldName) {
  if (!value) {
    return null;
  }

  if (!isoDatePattern.test(value) || Number.isNaN(Date.parse(value))) {
    throw createHttpError(400, `${fieldName} must be a valid ISO date in YYYY-MM-DD format`);
  }

  return value;
}

function parseOptionalHorizon(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const horizon = Number(value);
  if (!Number.isInteger(horizon) || horizon < 1 || horizon > 60) {
    throw createHttpError(400, "horizon must be an integer between 1 and 60");
  }

  return horizon;
}

function parseWindow(value) {
  const window = Number(value ?? 6);
  if (!allowedWindows.has(window)) {
    throw createHttpError(400, `window must be one of ${[...allowedWindows].join(", ")}`);
  }

  return window;
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

function groupRows(rows, domain) {
  const groups = new Map();

  for (const row of rows) {
    const key = [
      row.level,
      row.group_id,
      row.part_id ?? "",
      row.part_category ?? "",
      row.service_type ?? "",
      row.job_category ?? "",
      row.model_id ?? "",
      row.variant_id ?? ""
    ].join("|");

    if (!groups.has(key)) {
      groups.set(key, {
        level: row.level,
        groupId: row.group_id,
        groupLabel: row.group_label,
        partId: row.part_id ?? null,
        partCategory: row.part_category ?? null,
        serviceType: row.service_type ?? null,
        jobCategory: row.job_category ?? null,
        modelId: row.model_id,
        variantId: row.variant_id,
        seriesKey: row.group_id,
        seriesLabel: row.group_label,
        method: row.model_method,
        validation: {
          mae: row.validation_mae === null ? null : Number(row.validation_mae),
          rmse: row.validation_rmse === null ? null : Number(row.validation_rmse),
          mape: row.validation_mape === null ? null : Number(row.validation_mape)
        },
        forecast: []
      });
    }

    groups.get(key).forecast.push({
      month: row.forecast_month,
      unitsSold: Number(row.forecast_units),
      units: Number(row.forecast_units),
      lower_80: Number(row.lower_80),
      upper_80: Number(row.upper_80),
      lower_95: Number(row.lower_95),
      upper_95: Number(row.upper_95),
      dataQuality: row.data_quality ?? "rich"
    });
  }

  return [...groups.values()].map((series) => ({
    ...series,
    forecast: series.forecast.sort((left, right) => left.month.localeCompare(right.month)),
    domain
  }));
}

function buildDimensionSql(domain, query) {
  if (domain === "parts") {
    const includePartId = Boolean(query.partId || query.breakdown === "part");
    const includePartCategory = Boolean(query.partCategory || query.partId || query.breakdown === "part_category" || query.breakdown === "part");

    return {
      select: [
        includePartId ? "fd.part_id" : "NULL::VARCHAR AS part_id",
        includePartCategory ? "fd.part_category" : "NULL::VARCHAR AS part_category",
        "NULL::VARCHAR AS service_type",
        "NULL::VARCHAR AS job_category",
        "NULL::VARCHAR AS model_id",
        "NULL::VARCHAR AS variant_id"
      ].join(",\n          "),
      groupBy: [
        includePartId ? "fd.part_id" : null,
        includePartCategory ? "fd.part_category" : null
      ].filter(Boolean)
    };
  }

  const includeServiceType = Boolean(query.serviceType || query.breakdown === "service_type");
  const includeJobCategory = Boolean(query.jobCategory || query.breakdown === "job_category");

  return {
    select: [
      "NULL::VARCHAR AS part_id",
      "NULL::VARCHAR AS part_category",
      includeServiceType ? "fd.service_type" : "NULL::VARCHAR AS service_type",
      includeJobCategory ? "fd.job_category" : "NULL::VARCHAR AS job_category",
      "NULL::VARCHAR AS model_id",
      "NULL::VARCHAR AS variant_id"
    ].join(",\n          "),
    groupBy: [
      includeServiceType ? "fd.service_type" : null,
      includeJobCategory ? "fd.job_category" : null
    ].filter(Boolean)
  };
}

function buildActualDimensionSql(domain, query) {
  if (domain === "parts") {
    const includePartId = Boolean(query.partId || query.breakdown === "part");
    const includePartCategory = Boolean(query.partCategory || query.partId || query.breakdown === "part_category" || query.breakdown === "part");

    return {
      select: [
        includePartId ? "part_id" : "NULL::VARCHAR AS part_id",
        includePartCategory ? "part_category" : "NULL::VARCHAR AS part_category",
        "NULL::VARCHAR AS service_type",
        "NULL::VARCHAR AS job_category",
        "NULL::VARCHAR AS model_id",
        "NULL::VARCHAR AS variant_id"
      ].join(",\n        "),
      groupBy: [
        includePartId ? "part_id" : null,
        includePartCategory ? "part_category" : null
      ].filter(Boolean)
    };
  }

  const includeServiceType = Boolean(query.serviceType || query.breakdown === "service_type");
  const includeJobCategory = Boolean(query.jobCategory || query.breakdown === "job_category");

  return {
    select: [
      "NULL::VARCHAR AS part_id",
      "NULL::VARCHAR AS part_category",
      includeServiceType ? "service_type" : "NULL::VARCHAR AS service_type",
      includeJobCategory ? "job_category" : "NULL::VARCHAR AS job_category",
      "NULL::VARCHAR AS model_id",
      "NULL::VARCHAR AS variant_id"
    ].join(",\n        "),
    groupBy: [
      includeServiceType ? "service_type" : null,
      includeJobCategory ? "job_category" : null
    ].filter(Boolean)
  };
}

function buildActualBaseCte(domain, query, values) {
  const sourceConditions = ["sc.is_active = TRUE"];
  appendSourceScopeCondition(sourceConditions, values, query.scope);

  if (domain === "parts") {
    sourceConditions.push("sp.is_active = TRUE");
    if (query.partId) {
      values.push(query.partId);
      sourceConditions.push(`msd.part_id = $${values.length}`);
    }
    if (query.partCategory) {
      values.push(query.partCategory);
      sourceConditions.push(`sp.part_category = $${values.length}`);
    }
    if (query.modelId) {
      values.push(query.modelId);
      sourceConditions.push(`msd.model_id = $${values.length}`);
    }
    if (query.variantId) {
      values.push(query.variantId);
      sourceConditions.push(`msd.variant_id = $${values.length}`);
    }

    return `
      SELECT
        sc.service_center_id,
        sc.service_center_name,
        sc.state,
        sc.region,
        sp.part_id,
        sp.part_category,
        NULL::VARCHAR AS service_type,
        NULL::VARCHAR AS job_category,
        msd.model_id,
        msd.variant_id,
        msd.month,
        SUM(msd.quantity_demanded)::NUMERIC AS actual_units
      FROM monthly_service_parts_demand msd
      JOIN service_centers sc ON sc.service_center_id = msd.service_center_id
      JOIN service_parts sp ON sp.part_id = msd.part_id
      WHERE ${sourceConditions.join(" AND ")}
      GROUP BY sc.service_center_id, sc.service_center_name, sc.state, sc.region, sp.part_id, sp.part_category, msd.model_id, msd.variant_id, msd.month
    `;
  }

  if (query.serviceType) {
    values.push(query.serviceType);
    sourceConditions.push(`mov.service_type = $${values.length}`);
  }
  if (query.jobCategory) {
    values.push(query.jobCategory);
    sourceConditions.push(`mov.job_category = $${values.length}`);
  }
  if (query.modelId) {
    values.push(query.modelId);
    sourceConditions.push(`mov.model_id = $${values.length}`);
  }
  if (query.variantId) {
    values.push(query.variantId);
    sourceConditions.push(`mov.variant_id = $${values.length}`);
  }

  return `
    SELECT
      sc.service_center_id,
      sc.service_center_name,
      sc.state,
      sc.region,
      NULL::VARCHAR AS part_id,
      NULL::VARCHAR AS part_category,
      mov.service_type,
      mov.job_category,
      mov.model_id,
      mov.variant_id,
      mov.month,
      SUM(mov.order_count)::NUMERIC AS actual_units
    FROM monthly_service_order_volume mov
    JOIN service_centers sc ON sc.service_center_id = mov.service_center_id
    WHERE ${sourceConditions.join(" AND ")}
    GROUP BY sc.service_center_id, sc.service_center_name, sc.state, sc.region, mov.service_type, mov.job_category, mov.model_id, mov.variant_id, mov.month
  `;
}

function groupActualRows(rows, domain) {
  const groups = new Map();

  for (const row of rows) {
    const key = [
      row.level,
      row.group_id,
      row.part_id ?? "",
      row.part_category ?? "",
      row.service_type ?? "",
      row.job_category ?? "",
      row.model_id ?? "",
      row.variant_id ?? ""
    ].join("|");

    if (!groups.has(key)) {
      groups.set(key, {
        level: row.level,
        groupId: row.group_id,
        groupLabel: row.group_label,
        partId: row.part_id ?? null,
        partCategory: row.part_category ?? null,
        serviceType: row.service_type ?? null,
        jobCategory: row.job_category ?? null,
        modelId: row.model_id,
        variantId: row.variant_id,
        seriesKey: row.group_id,
        seriesLabel: row.group_label,
        actuals: []
      });
    }

    groups.get(key).actuals.push({
      month: row.month,
      unitsSold: Number(row.actual_units),
      units: Number(row.actual_units)
    });
  }

  return [...groups.values()].map((series) => ({
    ...series,
    actuals: series.actuals.sort((left, right) => left.month.localeCompare(right.month)),
    domain
  }));
}

function normalizeObservation(row) {
  return {
    level: row.level,
    groupId: row.group_id,
    groupLabel: row.group_label,
    month: row.month,
    forecastUnits: toNumber(row.forecast_units),
    actualUnits: toNumber(row.actual_units),
    error: toNumber(row.error),
    absoluteError: toNumber(row.absolute_error),
    percentageError: toNumber(row.percentage_error),
    absolutePercentageError: toNumber(row.absolute_percentage_error)
  };
}

function getDomainScope(user, domain) {
  return user ? getScope(user, domain) : { kind: "all", scopes: [] };
}

function hasOnlyServiceCenterScopes(scope) {
  return scope.kind === "Service Center" || (
    scope.kind === "multi" &&
    scope.serviceCenterIds?.length > 0 &&
    !scope.regions?.length &&
    !scope.scopes?.some((item) => item.type === "National")
  );
}

function resolveDomainScopeSelection(user, domain, requestedLevel, requestedGroupId) {
  const scope = getDomainScope(user, domain);

  if (hasOnlyServiceCenterScopes(scope)) {
    return {
      scope,
      level: "service_center",
      groupId: scope.serviceCenterId || requestedGroupId || null
    };
  }

  return {
    scope,
    level: requestedLevel || "zone",
    groupId: requestedGroupId || null
  };
}

function appendForecastScopeCondition(conditions, values, scope, level) {
  if (scope?.kind === "none") {
    conditions.push("FALSE");
    return;
  }

  if (!scope || scope.kind === "all") {
    return;
  }

  if (hasOnlyServiceCenterScopes(scope)) {
    const serviceCenterIds = scope.kind === "Service Center" ? [scope.serviceCenterId] : scope.serviceCenterIds;
    values.push(serviceCenterIds);
    conditions.push(`fd.level = 'service_center' AND fd.group_id = ANY($${values.length}::VARCHAR[])`);
    return;
  }

  const regions = scope.kind === "Region" ? [scope.region] : (scope.regions || []);
  if (regions.length === 0) {
    return;
  }

  values.push(regions);
  const parameter = `$${values.length}`;

  if (level === "zone") {
    conditions.push(`fd.group_id = ANY(${parameter}::VARCHAR[])`);
    return;
  }

  if (level === "state") {
    conditions.push(`
      EXISTS (
        SELECT 1
        FROM service_centers sc_scope
        WHERE sc_scope.state = fd.group_id
          AND sc_scope.region = ANY(${parameter}::VARCHAR[])
          AND sc_scope.is_active = TRUE
      )
    `);
    return;
  }

  if (level === "service_center") {
    conditions.push(`
      EXISTS (
        SELECT 1
        FROM service_centers sc_scope
        WHERE sc_scope.service_center_id = fd.group_id
          AND sc_scope.region = ANY(${parameter}::VARCHAR[])
          AND sc_scope.is_active = TRUE
      )
    `);
  }
}

function appendSourceScopeCondition(conditions, values, scope) {
  if (scope?.kind === "none") {
    conditions.push("FALSE");
    return;
  }

  if (!scope || scope.kind === "all") {
    return;
  }

  if (hasOnlyServiceCenterScopes(scope)) {
    const serviceCenterIds = scope.kind === "Service Center" ? [scope.serviceCenterId] : scope.serviceCenterIds;
    values.push(serviceCenterIds);
    conditions.push(`sc.service_center_id = ANY($${values.length}::VARCHAR[])`);
    return;
  }

  const regions = scope.kind === "Region" ? [scope.region] : (scope.regions || []);
  if (regions.length === 0) {
    return;
  }

  values.push(regions);
  conditions.push(`sc.region = ANY($${values.length}::VARCHAR[])`);
}

async function ensureDomainGroupAllowed(user, domain, level, groupId, db = pool) {
  const scope = getDomainScope(user, domain);
  if (scope.kind === "none") {
    throw createHttpError(403, "The requested forecast scope is outside your access");
  }

  if (hasOnlyServiceCenterScopes(scope)) {
    if (!groupId) return;
    const serviceCenterIds = scope.kind === "Service Center" ? [scope.serviceCenterId] : scope.serviceCenterIds;
    if (level === "service_center" && serviceCenterIds.includes(groupId)) return;
    throw createHttpError(403, "The requested forecast scope is outside your access");
  }

  const regions = scope.kind === "Region" ? [scope.region] : (scope.regions || []);
  if (!groupId || regions.length === 0) {
    return;
  }

  if (level === "zone" && regions.includes(groupId)) {
    return;
  }

  if (level === "state") {
    const result = await db.query(
      `
        SELECT 1
        FROM service_centers
        WHERE state = $1
          AND region = ANY($2::VARCHAR[])
          AND is_active = TRUE
        LIMIT 1
      `,
      [groupId, regions]
    );
    if (result.rowCount > 0) return;
  }

  if (level === "service_center") {
    const result = await db.query(
      `
        SELECT 1
        FROM service_centers
        WHERE service_center_id = $1
          AND region = ANY($2::VARCHAR[])
          AND is_active = TRUE
        LIMIT 1
      `,
      [groupId, regions]
    );
    if (result.rowCount > 0) return;
  }

  throw createHttpError(403, "The requested forecast scope is outside your access");
}

export async function getDomainForecastPayload(domain, query, user, db = pool) {
  const config = getDomainConfig(domain);
  const requestedGroupId = query.groupId || query.serviceCenterId || query.state || query.zone || null;
  const { scope, level, groupId } = resolveDomainScopeSelection(user, domain, query.level, requestedGroupId);
  const startDate = parseOptionalDate(query.startDate, "startDate");
  const endDate = parseOptionalDate(query.endDate, "endDate");
  const horizon = parseOptionalHorizon(query.horizon);

  if (!allowedLevels.has(level)) {
    throw createHttpError(400, `Unsupported forecast level "${level}"`);
  }

  if (startDate && endDate && Date.parse(startDate) > Date.parse(endDate)) {
    throw createHttpError(400, "startDate must be earlier than or equal to endDate");
  }

  await ensureDomainGroupAllowed(user, domain, level, groupId, db);

  const latestRun = await ForecastRun.findLatestCompleted({
    forecastDomain: config.forecastDomain,
    forecastType: config.forecastType
  });

  if (!latestRun) {
    throw createHttpError(404, `No completed ${domain} forecast run found`);
  }

  const values = [config.forecastType, latestRun.run_id, level];
  const conditions = [
    "fd.forecast_type = $1",
    "fd.run_id = $2",
    "fd.level = $3"
  ];
  appendForecastScopeCondition(conditions, values, scope, level);

  if (groupId) {
    values.push(groupId);
    conditions.push(`fd.group_id = $${values.length}`);
  }

  for (const [queryKey, column] of Object.entries(config.dimensionColumns)) {
    const value = query[queryKey];
    if (value) {
      values.push(value);
      conditions.push(`fd.${column} = $${values.length}`);
    }
  }

  if (startDate) {
    values.push(startDate);
    conditions.push(`fd.forecast_month >= $${values.length}::DATE`);
  }

  if (endDate) {
    values.push(endDate);
    conditions.push(`fd.forecast_month <= $${values.length}::DATE`);
  }

  values.push(Number.isInteger(Number(horizon)) ? Number(horizon) : null);
  const horizonParameter = `$${values.length}`;
  const dimensions = buildDimensionSql(domain, query);
  const groupByColumns = [
    "fd.level",
    "fd.group_id",
    "fd.group_label",
    "fd.forecast_month",
    ...dimensions.groupBy
  ];

  const result = await db.query(
    `
      WITH aggregated AS (
        SELECT
          fd.level,
          fd.group_id,
          fd.group_label,
          ${dimensions.select},
          TO_CHAR(fd.forecast_month, 'YYYY-MM-01') AS forecast_month,
          SUM(fd.${config.unitColumn})::NUMERIC AS forecast_units,
          ROUND(GREATEST(0, SUM(fd.${config.unitColumn}) - SQRT(SUM(POWER(GREATEST(fd.${config.unitColumn} - fd.lower_80, 0), 2)))))::NUMERIC AS lower_80,
          ROUND(SUM(fd.${config.unitColumn}) + SQRT(SUM(POWER(GREATEST(fd.upper_80 - fd.${config.unitColumn}, 0), 2))))::NUMERIC AS upper_80,
          ROUND(GREATEST(0, SUM(fd.${config.unitColumn}) - SQRT(SUM(POWER(GREATEST(fd.${config.unitColumn} - fd.lower_95, 0), 2)))))::NUMERIC AS lower_95,
          ROUND(SUM(fd.${config.unitColumn}) + SQRT(SUM(POWER(GREATEST(fd.upper_95 - fd.${config.unitColumn}, 0), 2))))::NUMERIC AS upper_95,
          CASE WHEN COUNT(DISTINCT fd.model_method) = 1 THEN MIN(fd.model_method) ELSE 'aggregated-domain-forecast' END AS model_method,
          AVG(fd.validation_mae) AS validation_mae,
          AVG(fd.validation_rmse) AS validation_rmse,
          AVG(fd.validation_mape) AS validation_mape,
          CASE WHEN COUNT(DISTINCT fd.data_quality) = 1 THEN MIN(fd.data_quality) ELSE 'sparse' END AS data_quality
        FROM ${config.tableName} fd
        WHERE ${conditions.join(" AND ")}
        GROUP BY ${groupByColumns.join(", ")}
      ),
      ranked AS (
        SELECT
          *,
          ROW_NUMBER() OVER (
            PARTITION BY level, group_id, part_id, part_category, service_type, job_category, model_id, variant_id
            ORDER BY fd.forecast_month
          ) AS horizon_month
        FROM aggregated fd
      )
      SELECT *
      FROM ranked
      WHERE (${horizonParameter}::INTEGER IS NULL OR horizon_month <= ${horizonParameter}::INTEGER)
      ORDER BY level, group_label, group_id, forecast_month
    `,
    values
  );

  return {
    ok: true,
    domain,
    forecastType: config.forecastType,
    runId: latestRun.run_id,
    horizon: latestRun.horizon_months,
    completedAt: latestRun.completed_at,
    filters: {
      level,
      groupId,
      startDate,
      endDate,
      horizon,
      ...Object.fromEntries(Object.keys(config.dimensionColumns).map((key) => [key, query[key] || null]))
    },
    series: groupRows(result.rows, domain)
  };
}

export async function getDomainActualsPayload(domain, query, user, db = pool) {
  getDomainConfig(domain);
  const requestedGroupId = query.groupId || query.serviceCenterId || query.state || query.zone || null;
  const { scope, level, groupId } = resolveDomainScopeSelection(user, domain, query.level, requestedGroupId);
  const horizon = parseOptionalHorizon(query.horizon) || 6;

  if (!allowedLevels.has(level)) {
    throw createHttpError(400, `Unsupported forecast level "${level}"`);
  }

  await ensureDomainGroupAllowed(user, domain, level, groupId, db);

  const values = [];
  const scopedQuery = { ...query, scope };
  const baseCte = buildActualBaseCte(domain, scopedQuery, values);
  values.push(level);
  const levelParameter = `$${values.length}`;
  const conditions = [`level = ${levelParameter}`];

  if (groupId) {
    values.push(groupId);
    conditions.push(`group_id = $${values.length}`);
  }

  values.push(horizon);
  const horizonParameter = `$${values.length}`;
  const dimensions = buildActualDimensionSql(domain, query);
  const groupByColumns = [
    "level",
    "group_id",
    "group_label",
    "month",
    ...dimensions.groupBy
  ];

  const result = await db.query(
    `
      WITH source_rows AS (${baseCte}),
      scoped AS (
        SELECT 'service_center'::VARCHAR AS level, service_center_id AS group_id, service_center_name AS group_label, * FROM source_rows
        UNION ALL
        SELECT 'state'::VARCHAR AS level, state AS group_id, state AS group_label, * FROM source_rows
        UNION ALL
        SELECT 'zone'::VARCHAR AS level, region AS group_id, region AS group_label, * FROM source_rows
      ),
      latest_month AS (
        SELECT MAX(month) AS max_month FROM scoped
      ),
      aggregated AS (
        SELECT
          level,
          group_id,
          group_label,
          ${dimensions.select},
          TO_CHAR(month, 'YYYY-MM-01') AS month,
          SUM(actual_units)::NUMERIC AS actual_units
        FROM scoped
        CROSS JOIN latest_month lm
        WHERE ${conditions.join(" AND ")}
          AND lm.max_month IS NOT NULL
          AND month >= lm.max_month - (($${values.length}::INTEGER - 1) * INTERVAL '1 month')
          AND month <= lm.max_month
        GROUP BY ${groupByColumns.join(", ")}
      )
      SELECT *
      FROM aggregated
      ORDER BY level, group_label, group_id, month
    `,
    values
  );

  return {
    ok: true,
    domain,
    filters: {
      level,
      groupId,
      horizon
    },
    series: groupActualRows(result.rows, domain)
  };
}

export async function getDomainDiagnosticsPayload(domain, query, user, db = pool) {
  getDomainConfig(domain);
  const requestedGroupId = query.groupId || query.serviceCenterId || query.state || query.zone || null;
  const { scope, level, groupId } = resolveDomainScopeSelection(user, domain, query.level, requestedGroupId);
  const window = parseWindow(query.window);
  const limit = Math.min(Math.max(Number(query.limit || 500), 1), 1000);

  if (!allowedLevels.has(level)) {
    throw createHttpError(400, `Unsupported forecast level "${level}"`);
  }

  await ensureDomainGroupAllowed(user, domain, level, groupId, db);

  const values = [];
  const scopedQuery = { ...query, scope };
  const baseCte = buildActualBaseCte(domain, scopedQuery, values);
  values.push(level);
  const levelParameter = `$${values.length}`;
  const conditions = [`level = ${levelParameter}`];

  if (groupId) {
    values.push(groupId);
    conditions.push(`group_id = $${values.length}`);
  }

  values.push(window);
  const windowParameter = `$${values.length}`;
  values.push(limit);
  const limitParameter = `$${values.length}`;

  const result = await db.query(
    `
      WITH source_rows AS (${baseCte}),
      scoped AS (
        SELECT 'service_center'::VARCHAR AS level, service_center_id AS group_id, service_center_name AS group_label, * FROM source_rows
        UNION ALL
        SELECT 'state'::VARCHAR AS level, state AS group_id, state AS group_label, * FROM source_rows
        UNION ALL
        SELECT 'zone'::VARCHAR AS level, region AS group_id, region AS group_label, * FROM source_rows
      ),
      filtered AS (
        SELECT
          level,
          group_id,
          group_label,
          month,
          SUM(actual_units)::NUMERIC AS actual_units
        FROM scoped
        WHERE ${conditions.join(" AND ")}
        GROUP BY level, group_id, group_label, month
      ),
      latest_month AS (
        SELECT MAX(month) AS max_month FROM filtered
      ),
      rolling AS (
        SELECT
          level,
          group_id,
          group_label,
          month,
          actual_units,
          AVG(actual_units) OVER (
            PARTITION BY level, group_id
            ORDER BY month
            ROWS BETWEEN 3 PRECEDING AND 1 PRECEDING
          ) AS forecast_units
        FROM filtered
      ),
      observations AS (
        SELECT
          r.level,
          r.group_id,
          r.group_label,
          TO_CHAR(r.month, 'YYYY-MM-01') AS month,
          r.forecast_units,
          r.actual_units,
          r.forecast_units - r.actual_units AS error,
          ABS(r.forecast_units - r.actual_units) AS absolute_error,
          CASE WHEN r.actual_units = 0 THEN NULL ELSE ((r.forecast_units - r.actual_units) / r.actual_units) * 100 END AS percentage_error,
          CASE WHEN r.actual_units = 0 THEN NULL ELSE ABS(r.forecast_units - r.actual_units) / r.actual_units * 100 END AS absolute_percentage_error
        FROM rolling r
        CROSS JOIN latest_month lm
        WHERE r.forecast_units IS NOT NULL
          AND lm.max_month IS NOT NULL
          AND r.month >= lm.max_month - ((${windowParameter}::INTEGER - 1) * INTERVAL '1 month')
          AND r.month <= lm.max_month
      ),
      trend AS (
        SELECT
          month,
          AVG(absolute_error) AS mae,
          SQRT(AVG(error * error)) AS rmse,
          AVG(absolute_percentage_error) AS mape,
          AVG(error) AS bias,
          CASE WHEN AVG(actual_units) = 0 THEN NULL ELSE AVG(error) / AVG(actual_units) * 100 END AS bias_pct,
          COUNT(*)::INTEGER AS sample_count
        FROM observations
        GROUP BY month
      ),
      buckets AS (
        SELECT
          FLOOR(percentage_error / 10) * 10 AS bucket_start,
          COUNT(*)::INTEGER AS count
        FROM observations
        WHERE percentage_error IS NOT NULL
        GROUP BY bucket_start
      ),
      leaderboard AS (
        SELECT
          level,
          group_id,
          group_label,
          AVG(absolute_error) AS mae,
          SQRT(AVG(error * error)) AS rmse,
          AVG(absolute_percentage_error) AS mape,
          AVG(error) AS bias,
          CASE WHEN AVG(actual_units) = 0 THEN NULL ELSE AVG(error) / AVG(actual_units) * 100 END AS bias_pct,
          COUNT(*)::INTEGER AS sample_count
        FROM observations
        GROUP BY level, group_id, group_label
      ),
      limited_observations AS (
        SELECT * FROM observations ORDER BY month, group_label, group_id LIMIT ${limitParameter}
      )
      SELECT
        COALESCE((SELECT JSON_AGG(t ORDER BY t.month) FROM trend t), '[]'::JSON) AS trend,
        COALESCE((SELECT JSON_AGG(o ORDER BY o.month, o.group_label, o.group_id) FROM limited_observations o), '[]'::JSON) AS observations,
        COALESCE((SELECT JSON_AGG(b ORDER BY b.bucket_start) FROM buckets b), '[]'::JSON) AS buckets,
        COALESCE((SELECT JSON_AGG(l ORDER BY l.mape ASC NULLS LAST, l.sample_count DESC) FROM leaderboard l), '[]'::JSON) AS leaderboard
    `,
    values
  );

  const row = result.rows[0] || {};
  const trend = row.trend || [];
  const observations = row.observations || [];
  const buckets = row.buckets || [];
  const leaderboard = row.leaderboard || [];

  return {
    ok: true,
    domain,
    filters: {
      level,
      groupId,
      window
    },
    trend: trend.map((item) => ({
      month: item.month,
      mape: round(item.mape),
      mae: round(item.mae),
      rmse: round(item.rmse),
      bias: round(item.bias),
      biasPct: round(item.bias_pct),
      sampleCount: Number(item.sample_count || 0)
    })),
    observations: observations.map(normalizeObservation),
    buckets: buckets.map((item) => ({
      minErrorPct: round(item.bucket_start),
      maxErrorPct: round(Number(item.bucket_start) + 10),
      count: Number(item.count || 0)
    })),
    leaderboard: leaderboard.map((item, index) => ({
      rank: index + 1,
      level: item.level,
      groupId: item.group_id,
      groupLabel: item.group_label,
      mape: round(item.mape),
      mae: round(item.mae),
      rmse: round(item.rmse),
      bias: round(item.bias),
      biasPct: round(item.bias_pct),
      sampleCount: Number(item.sample_count || 0)
    }))
  };
}

export async function getDomainReferencePayload(domain, user, db = pool) {
  const scope = getDomainScope(user, domain);
  const centerValues = [];
  const centerConditions = ["is_active = TRUE"];
  const sourceValues = [];
  const sourceConditions = ["sc.is_active = TRUE"];

  if (scope.kind === "none") {
    centerConditions.push("FALSE");
    sourceConditions.push("FALSE");
  }

  const scopedRegions = scope.kind === "Region" ? [scope.region] : (scope.regions || []);
  const centerScopeChecks = [];
  const sourceScopeChecks = [];
  if (scopedRegions.length > 0) {
    centerValues.push(scopedRegions);
    centerScopeChecks.push(`region = ANY($${centerValues.length}::VARCHAR[])`);
    sourceValues.push(scopedRegions);
    sourceScopeChecks.push(`sc.region = ANY($${sourceValues.length}::VARCHAR[])`);
  }

  const scopedServiceCenterIds = scope.kind === "Service Center" ? [scope.serviceCenterId] : (scope.serviceCenterIds || []);
  if (scopedServiceCenterIds.length > 0) {
    centerValues.push(scopedServiceCenterIds);
    centerScopeChecks.push(`service_center_id = ANY($${centerValues.length}::VARCHAR[])`);
    sourceValues.push(scopedServiceCenterIds);
    sourceScopeChecks.push(`sc.service_center_id = ANY($${sourceValues.length}::VARCHAR[])`);
  }

  if (centerScopeChecks.length > 0) {
    centerConditions.push(`(${centerScopeChecks.join(" OR ")})`);
    sourceConditions.push(`(${sourceScopeChecks.join(" OR ")})`);
  }

  if (domain === "parts") {
    const [centersResult, partsResult] = await Promise.all([
      db.query(
        `
        SELECT service_center_id, service_center_name, region, city, state, center_type
        FROM service_centers
        WHERE ${centerConditions.join(" AND ")}
        ORDER BY service_center_name
      `,
        centerValues
      ),
      db.query(
        `
        SELECT DISTINCT sp.part_id, sp.part_number, sp.part_name, sp.part_category, sp.part_type, sp.criticality, sp.abc_class
        FROM service_parts sp
        JOIN monthly_service_parts_demand msd ON msd.part_id = sp.part_id
        JOIN service_centers sc ON sc.service_center_id = msd.service_center_id
        WHERE sp.is_active = TRUE
          AND ${sourceConditions.join(" AND ")}
        ORDER BY part_category, part_name
      `,
        sourceValues
      )
    ]);

    return {
      ok: true,
      serviceCenters: centersResult.rows.map((row) => ({
        id: row.service_center_id,
        name: row.service_center_name,
        region: row.region,
        city: row.city,
        state: row.state,
        centerType: row.center_type
      })),
      parts: partsResult.rows.map((row) => ({
        id: row.part_id,
        number: row.part_number,
        name: row.part_name,
        category: row.part_category,
        type: row.part_type,
        criticality: row.criticality,
        abcClass: row.abc_class
      }))
    };
  }

  if (domain === "service") {
    const [centersResult, optionsResult] = await Promise.all([
      db.query(
        `
        SELECT service_center_id, service_center_name, region, city, state, center_type
        FROM service_centers
        WHERE ${centerConditions.join(" AND ")}
        ORDER BY service_center_name
      `,
        centerValues
      ),
      db.query(
        `
        SELECT DISTINCT mov.service_type, mov.job_category
        FROM monthly_service_order_volume mov
        JOIN service_centers sc ON sc.service_center_id = mov.service_center_id
        WHERE ${sourceConditions.join(" AND ")}
        ORDER BY service_type, job_category
      `,
        sourceValues
      )
    ]);

    return {
      ok: true,
      serviceCenters: centersResult.rows.map((row) => ({
        id: row.service_center_id,
        name: row.service_center_name,
        region: row.region,
        city: row.city,
        state: row.state,
        centerType: row.center_type
      })),
      serviceTypes: [...new Set(optionsResult.rows.map((row) => row.service_type).filter(Boolean))].sort(),
      jobCategories: [...new Set(optionsResult.rows.map((row) => row.job_category).filter(Boolean))].sort()
    };
  }

  throw createHttpError(404, "Unsupported forecast domain");
}
