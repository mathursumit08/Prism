import { ForecastData, ForecastRun } from "../data/models/index.js";
import { pool } from "../db.js";
import { canAccessForecastLevel, getScope, isGroupAllowed } from "../auth/accessControl.js";
import { ForecastCacheService } from "./forecastCacheService.js";

const allowedLevels = new Set(["dealer", "state", "zone"]);
const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;

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

function currentMonthStart() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
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

export const forecastEndpointConfigs = {
  // Versioned endpoint aliases all resolve into the same forecast_data store,
  // with each alias constraining the level or output shape it exposes.
  baseline: {
    endpoint: "baseline",
    level: null
  },
  actuals: {
    endpoint: "actuals",
    level: null
  },
  "dealer-targets": {
    endpoint: "dealer-targets",
    level: "dealer"
  },
  blended: {
    endpoint: "blended",
    level: "dealer"
  },
  national: {
    endpoint: "national",
    level: "zone"
  },
  regional: {
    endpoint: "regional",
    level: "zone"
  }
};

export async function getBaselineForecastPayload(user, query) {
  const level = query.level;
  const groupId = resolveGroupId(level, query);
  const segment = query.segment;
  const modelId = query.modelId || query.ModelId;
  const variantId = query.variantId || query.VariantId;
  const breakdown = query.breakdown;
  const startDate = parseOptionalDate(query.startDate, "startDate");
  const endDate = parseOptionalDate(query.endDate, "endDate");
  const horizon = parseOptionalHorizon(query.horizon);

  if (startDate && endDate && Date.parse(startDate) > Date.parse(endDate)) {
    throw createHttpError(400, "startDate must be earlier than or equal to endDate");
  }

  validateLevel(level);
  await ensureUserScopeAccess(user, level || "zone", groupId);

  const latestRun = await ForecastRun.findLatestCompleted();

  if (!latestRun) {
    throw createHttpError(404, "No completed baseline forecast run found");
  }

  const filters = {
    level: level || "all",
    groupId: groupId || null,
    segment: segment || null,
    modelId: modelId || null,
    variantId: variantId || null,
    breakdown: breakdown || null,
    startDate,
    endDate,
    horizon
  };
  // The latest completed run id is part of the cache key so a regeneration
  // naturally invalidates stale response payloads.
  const cacheKey = buildCacheKey(latestRun.run_id, {
    ...filters,
    username: user.username
  });
  const cachedPayload = ForecastCacheService.get(cacheKey);

  if (cachedPayload) {
    return cachedPayload;
  }

  const rows = await ForecastData.findLatest({
    level,
    groupId,
    segment,
    modelId,
    variantId,
    breakdown,
    scope: getScope(user),
    startDate,
    endDate,
    horizon
  });

  const payload = {
    ok: true,
    runId: latestRun.run_id,
    horizon: latestRun.horizon_months,
    completedAt: latestRun.completed_at,
    filters,
    series: groupForecastRows(rows, breakdown)
  };

  ForecastCacheService.set(cacheKey, payload);
  return payload;
}

export async function getActualsPayload(user, query) {
  const level = query.level;
  const groupId = resolveGroupId(level, query);
  const segment = query.segment;
  const modelId = query.modelId || query.ModelId;
  const variantId = query.variantId || query.VariantId;
  const breakdown = query.breakdown;

  validateLevel(level);
  await ensureUserScopeAccess(user, level || "zone", groupId);

  const rows = await findActualRows({
    level,
    groupId,
    segment,
    modelId,
    variantId,
    breakdown,
    scope: getScope(user)
  });

  return {
    ok: true,
    filters: {
      level: level || "dealer",
      groupId: groupId || null,
      segment: segment || null,
      modelId: modelId || null,
      variantId: variantId || null,
      breakdown: breakdown || null
    },
    series: groupActualRows(rows, breakdown)
  };
}

export async function getVersionedForecastPayload(user, endpointConfig, filters) {
  if (!endpointConfig) {
    throw createHttpError(404, "Unsupported forecast endpoint");
  }

  await ensureUserScopeAccess(user, endpointConfig.level, resolveGroupIdForEndpoint(endpointConfig, filters));

  const latestRun = await ForecastRun.findLatestCompleted();
  if (!latestRun) {
    throw createHttpError(404, "No completed baseline forecast run found");
  }

  const scope = getScope(user);
  const normalizedResult =
    endpointConfig.endpoint === "blended"
      ? await buildBlendedForecastResult(filters, scope)
      : {
          rows: await normalizeRows(
            endpointConfig,
            await ForecastData.findLatest({
              forecastType: "baseline",
              groupId: resolveGroupIdForEndpoint(endpointConfig, filters),
              level: endpointConfig.level,
              scope,
              segment: filters.segment,
              modelId: filters.modelId,
              variantId: filters.variantId,
              startDate: filters.startDate,
              endDate: filters.endDate,
              horizon: filters.horizon
            }),
            filters,
            scope
          ),
          modelWeights: null
        };
  const normalizedRows = normalizedResult.rows;
  const paged = paginateRows(normalizedRows, filters.page, filters.pageSize);

  return {
    ok: true,
    endpoint: endpointConfig.endpoint,
    runId: latestRun.run_id,
    completedAt: latestRun.completed_at,
    filters,
    ...(normalizedResult.modelWeights ? { modelWeights: normalizedResult.modelWeights } : {}),
    pagination: paged.pagination,
    data: paged.data
  };
}

export async function getSalesKpiPayload(user, query, db = pool) {
  const level = query.level;
  const groupId = resolveGroupId(level, query);
  const segment = query.segment;
  const modelId = query.modelId || query.ModelId;
  const variantId = query.variantId || query.VariantId;
  const horizon = parseOptionalHorizon(query.horizon) || 6;
  const startDate = parseOptionalDate(query.startDate, "startDate") || currentMonthStart();
  const scope = getScope(user);

  validateLevel(level);
  await ensureUserScopeAccess(user, level || "zone", groupId);

  const forecastSummary = await getSalesKpiForecastSummary({
    level,
    groupId,
    segment,
    modelId,
    variantId,
    scope,
    startDate,
    horizon
  }, db);
  const forecastUnits = forecastSummary.forecastUnits;

  const actualValues = [];
  const actualConditions = [
    "d.is_active = TRUE",
    "vm.is_active = TRUE",
    "vm.is_discontinued = FALSE",
    "vv.is_active = TRUE",
    "vv.is_discontinued = FALSE"
  ];

  if (groupId) {
    actualValues.push(groupId);
    const groupParameter = `$${actualValues.length}`;
    if (level === "dealer") {
      actualConditions.push(`d.dealer_id = ${groupParameter}`);
    } else if (level === "state") {
      actualConditions.push(`d.state = ${groupParameter}`);
    } else {
      actualConditions.push(`d.region = ${groupParameter}`);
    }
  }

  if (segment) {
    actualValues.push(segment);
    actualConditions.push(`vm.segment = $${actualValues.length}`);
  }

  if (modelId) {
    actualValues.push(modelId);
    actualConditions.push(`m.model_id = $${actualValues.length}`);
  }

  if (variantId) {
    actualValues.push(variantId);
    actualConditions.push(`m.variant_id = $${actualValues.length}`);
  }

  appendSalesSourceScopeCondition(actualConditions, actualValues, scope, "d");
  actualValues.push(horizon);
  const horizonParameter = `$${actualValues.length}`;

  const actualResult = await db.query(
    `
      WITH latest_month AS (
        SELECT MAX(month) AS max_month
        FROM monthly_sales_data
      )
      SELECT
        SUM(m.units_sold)::NUMERIC AS actual_units,
        SUM(m.stock_available)::NUMERIC AS stock_available,
        AVG(m.inventory_days)::NUMERIC AS inventory_days,
        TO_CHAR(MIN(m.month), 'YYYY-MM-01') AS actual_start_month,
        TO_CHAR(MAX(m.month), 'YYYY-MM-01') AS actual_end_month
      FROM monthly_sales_data m
      CROSS JOIN latest_month lm
      JOIN dealers d ON d.dealer_id = m.dealer_id
      JOIN vehicle_models vm ON vm.model_id = m.model_id
      JOIN vehicle_variants vv ON vv.variant_id = m.variant_id
        AND vv.model_id = m.model_id
      WHERE ${actualConditions.join(" AND ")}
        AND lm.max_month IS NOT NULL
        AND m.month >= lm.max_month - ((${horizonParameter}::INTEGER - 1) * INTERVAL '1 month')
        AND m.month <= lm.max_month
    `,
    actualValues
  );

  const actualRow = actualResult.rows[0] || {};
  const actualUnits = toNumber(actualRow.actual_units) || 0;
  const validationMape = forecastSummary.averageMape;
  const observedMape =
    actualUnits > 0 && forecastUnits > 0
      ? Math.abs(forecastUnits - actualUnits) / actualUnits * 100
      : null;
  const effectiveMape = validationMape ?? observedMape;
  const forecastAccuracy = effectiveMape === null ? null : Math.max(0, 100 - effectiveMape);
  const actualsVsForecast = forecastUnits > 0 ? (actualUnits / forecastUnits) * 100 : null;
  const forecastBias = actualUnits > 0 ? ((forecastUnits - actualUnits) / actualUnits) * 100 : null;

  return {
    ok: true,
    filters: {
      level: level || "zone",
      groupId: groupId || null,
      segment: segment || null,
      modelId: modelId || null,
      variantId: variantId || null,
      horizon,
      startDate
    },
    window: {
      actualStartMonth: actualRow.actual_start_month || null,
      actualEndMonth: actualRow.actual_end_month || null,
      forecastStartMonth: startDate
    },
    kpis: {
      salesForecastAccuracy: {
        value: round(forecastAccuracy, 1),
        mape: round(effectiveMape, 1),
        sampleCount: forecastSummary.sampleCount
      },
      salesActualsVsForecast: {
        value: round(actualsVsForecast, 1),
        actual: round(actualUnits, 0),
        forecast: round(forecastUnits, 0)
      },
      salesForecastBias: {
        value: round(forecastBias, 1),
        actual: round(actualUnits, 0),
        forecast: round(forecastUnits, 0)
      },
      inventoryCoverage: {
        value: round(actualRow.inventory_days, 1),
        unit: "days",
        stockAvailable: round(actualRow.stock_available, 0)
      }
    }
  };
}

function validateLevel(level) {
  if (level && !allowedLevels.has(level)) {
    throw createHttpError(400, `Unsupported forecast level "${level}"`);
  }
}

function salesScopeRegions(scope) {
  return scope?.kind === "Region" ? [scope.region] : (scope?.regions || []);
}

function salesScopeDealerIds(scope) {
  return scope?.kind === "Dealer" ? [scope.dealerId] : (scope?.dealerIds || []);
}

function hasOnlyDealerSalesScope(scope) {
  return scope?.kind === "Dealer" || (
    scope?.kind === "multi" &&
    salesScopeDealerIds(scope).length > 0 &&
    salesScopeRegions(scope).length === 0 &&
    !scope.scopes?.some((item) => item.type === "National")
  );
}

async function getSalesKpiForecastSummary(
  { level, groupId, segment, modelId, variantId, scope, startDate, horizon },
  db = pool
) {
  const latestRun = await ForecastRun.findLatestCompleted({ forecastDomain: "Sales", forecastType: "baseline" }, db);
  if (!latestRun) {
    return {
      forecastUnits: 0,
      averageMape: null,
      sampleCount: 0
    };
  }

  const conditions = [
    "fd.forecast_type = $1",
    "fd.run_id = $2"
  ];
  const values = ["baseline", latestRun.run_id];

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
  } else if (!modelId && !variantId) {
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

  appendForecastDataScopeCondition(conditions, values, scope);
  if (startDate) {
    values.push(startDate);
    conditions.push(`fd.forecast_month >= $${values.length}::DATE`);
  }

  values.push(Number.isInteger(Number(horizon)) ? Number(horizon) : null);
  const horizonParameter = `$${values.length}`;

  const result = await db.query(
    `
      WITH ranked AS (
        SELECT
          fd.forecast_units,
          fd.validation_mape,
          ROW_NUMBER() OVER (
            PARTITION BY fd.level, fd.group_id, fd.segment, fd.model_id, fd.variant_id
            ORDER BY fd.forecast_month
          ) AS horizon_month
        FROM forecast_data fd
        WHERE ${conditions.join(" AND ")}
      )
      SELECT
        COALESCE(SUM(forecast_units), 0)::NUMERIC AS forecast_units,
        AVG(validation_mape)::NUMERIC AS average_mape,
        COUNT(validation_mape)::INTEGER AS sample_count
      FROM ranked
      WHERE (${horizonParameter}::INTEGER IS NULL OR horizon_month <= ${horizonParameter}::INTEGER)
    `,
    values
  );

  const row = result.rows[0] || {};
  return {
    forecastUnits: toNumber(row.forecast_units) || 0,
    averageMape: toNumber(row.average_mape),
    sampleCount: Number(row.sample_count || 0)
  };
}

function appendSalesSourceScopeCondition(conditions, values, scope, dealerAlias = "d", parameterOffset = 0) {
  if (scope?.kind === "none") {
    conditions.push("FALSE");
    return;
  }

  if (!scope || scope.kind === "all") {
    return;
  }

  const regions = salesScopeRegions(scope);
  const dealerIds = salesScopeDealerIds(scope);
  const checks = [];
  const prefix = dealerAlias ? `${dealerAlias}.` : "";

  if (regions.length > 0) {
    values.push(regions);
    checks.push(`${prefix}region = ANY($${values.length + parameterOffset}::VARCHAR[])`);
  }

  if (dealerIds.length > 0) {
    values.push(dealerIds);
    checks.push(`${prefix}dealer_id = ANY($${values.length + parameterOffset}::VARCHAR[])`);
  }

  if (checks.length > 0) {
    conditions.push(`(${checks.join(" OR ")})`);
  }
}

function appendForecastDataScopeCondition(conditions, values, scope) {
  if (scope?.kind === "none") {
    conditions.push("FALSE");
    return;
  }

  if (!scope || scope.kind === "all") {
    return;
  }

  const regions = salesScopeRegions(scope);
  const dealerIds = salesScopeDealerIds(scope);
  const checks = [];

  if (regions.length > 0) {
    values.push(regions);
    const parameter = `$${values.length}`;
    checks.push(`
      (
        (fd.level = 'zone' AND fd.group_id = ANY(${parameter}::VARCHAR[]))
        OR EXISTS (
          SELECT 1
          FROM dealers d_scope
          WHERE d_scope.is_active = TRUE
            AND d_scope.region = ANY(${parameter}::VARCHAR[])
            AND (
              (fd.level = 'state' AND d_scope.state = fd.group_id)
              OR (fd.level = 'dealer' AND d_scope.dealer_id = fd.group_id)
            )
        )
      )
    `);
  }

  if (dealerIds.length > 0) {
    values.push(dealerIds);
    const parameter = `$${values.length}`;
    checks.push(`(fd.level = 'dealer' AND fd.group_id = ANY(${parameter}::VARCHAR[]))`);
  }

  if (checks.length > 0) {
    conditions.push(`(${checks.join(" OR ")})`);
  }
}

async function ensureUserScopeAccess(user, level, groupId) {
  if (level && !canAccessForecastLevel(user, level)) {
    throw createHttpError(403, "This role cannot access the requested forecast level");
  }

  if (!(await isGroupAllowed(user, level, groupId))) {
    throw createHttpError(403, "The requested forecast scope is outside your access");
  }
}

function groupForecastRows(rows, breakdown) {
  const groups = new Map();

  for (const row of rows) {
    const key = `${row.level}:${row.group_id}:${row.segment ?? ""}:${row.model_id ?? ""}:${row.variant_id ?? ""}`;

    if (!groups.has(key)) {
      groups.set(key, {
        level: row.level,
        groupId: row.group_id,
        groupLabel: row.group_label,
        segment: row.segment ?? null,
        modelId: row.model_id,
        variantId: row.variant_id,
        seriesKey: breakdown === "segment" ? (row.segment ?? row.group_id) : row.group_id,
        seriesLabel: breakdown === "segment" ? (row.segment ?? row.group_label) : row.group_label,
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
      lower_80: Number(row.lower_80),
      upper_80: Number(row.upper_80),
      lower_95: Number(row.lower_95),
      upper_95: Number(row.upper_95),
      dataQuality: row.data_quality ?? "rich",
      biasCorrection: Number(row.bias_correction ?? 1)
    });
  }

  return [...groups.values()];
}

function groupActualRows(rows, breakdown) {
  const groups = new Map();

  for (const row of rows) {
    const key = `${row.level}:${row.group_id}`;

    if (!groups.has(key)) {
      groups.set(key, {
        level: row.level,
        groupId: row.group_id,
        groupLabel: row.group_label,
        segment: row.segment ?? null,
        seriesKey: breakdown === "segment" ? row.group_id : row.group_id,
        seriesLabel: breakdown === "segment" ? row.group_label : row.group_label,
        actuals: []
      });
    }

    groups.get(key).actuals.push({
      month: row.month,
      unitsSold: Number(row.units_sold)
    });
  }

  return [...groups.values()];
}

function resolveGroupId(level, query) {
  if (query.groupId) {
    return query.groupId;
  }

  if (level === "zone") {
    return query.zone || null;
  }

  if (level === "state") {
    return query.state || null;
  }

  return query.dealerId || null;
}

function buildCacheKey(runId, filters) {
  return JSON.stringify({
    runId,
    ...filters
  });
}

async function findActualRows({ level, groupId, segment, modelId, variantId, breakdown, scope }) {
  const levelColumns = {
    dealer: {
      id: "d.dealer_id",
      label: "d.dealer_name"
    },
    state: {
      id: "d.state",
      label: "d.state"
    },
    zone: {
      id: "d.region",
      label: "d.region"
    }
  };

  const resolvedLevel = levelColumns[level] ? level : "dealer";
  const config = levelColumns[resolvedLevel];
  const values = [];
  const conditions = [
    "d.is_active = TRUE",
    "vm.is_active = TRUE",
    "vm.is_discontinued = FALSE",
    "vv.is_active = TRUE",
    "vv.is_discontinued = FALSE"
  ];
  const outputId = breakdown === "segment" ? "vm.segment" : config.id;
  const outputLabel = breakdown === "segment" ? "vm.segment" : config.label;
  const outputSegment = breakdown === "segment" ? "vm.segment" : "NULL::VARCHAR(40)";
  const groupByColumns =
    breakdown === "segment" ? "vm.segment, m.month" : `${config.id}, ${config.label}, m.month`;

  if (groupId) {
    values.push(groupId);
    conditions.push(`${config.id} = $${values.length + 1}`);
  }

  if (segment) {
    values.push(segment);
    conditions.push(`vm.segment = $${values.length + 1}`);
  }

  if (modelId) {
    values.push(modelId);
    conditions.push(`m.model_id = $${values.length + 1}`);
  }

  if (variantId) {
    values.push(variantId);
    conditions.push(`m.variant_id = $${values.length + 1}`);
  }

  appendSalesSourceScopeCondition(conditions, values, scope, "d", 1);

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const result = await pool.query(
    `
      SELECT
        $1::VARCHAR AS level,
        ${outputId} AS group_id,
        ${outputLabel} AS group_label,
        ${outputSegment} AS segment,
        TO_CHAR(m.month, 'YYYY-MM-01') AS month,
        SUM(m.units_sold)::INTEGER AS units_sold
      FROM monthly_sales_data m
      JOIN dealers d ON d.dealer_id = m.dealer_id
      JOIN vehicle_models vm ON vm.model_id = m.model_id
      JOIN vehicle_variants vv ON vv.variant_id = m.variant_id
        AND vv.model_id = m.model_id
      ${where}
      GROUP BY ${groupByColumns}
      ORDER BY ${outputLabel}, m.month
    `,
    [resolvedLevel, ...values]
  );

  return result.rows;
}

function resolveGroupIdForEndpoint(config, filters) {
  if (config.endpoint === "blended" && filters.groupId) {
    return filters.groupId;
  }

  if (config.endpoint === "regional" && filters.region) {
    return filters.region;
  }

  return null;
}

async function normalizeRows(config, rows, filters, scope) {
  let workingRows = rows;

  if (config.endpoint === "dealer-targets" || config.endpoint === "blended") {
    workingRows = await filterDealerRowsByRegion(workingRows, filters.region, scope);
  }

  if (config.endpoint === "national") {
    workingRows = aggregateToNationalRows(workingRows);
  }

  if (config.endpoint === "blended") {
    const nationalRows = aggregateToNationalRows(workingRows).map((row) => ({
      ...row,
      sourceLevel: "national"
    }));
    const regionalRows = aggregateToRegionalRows(workingRows).map((row) => ({
      ...row,
      sourceLevel: "regional"
    }));
    const dealerRows = workingRows.map((row) => ({
      ...row,
      sourceLevel: "dealer"
    }));
    workingRows = [...nationalRows, ...regionalRows, ...dealerRows];
  }

  const filteredRows = filterRowsByDateAndHorizon(workingRows, filters);
  return filteredRows.map((row) => normalizeForecastRow(config, row));
}

async function buildBlendedForecastResult(filters, scope) {
  const dealerRows = await ForecastData.findLatest({
    forecastType: "baseline",
    groupId: filters.groupId,
    level: "dealer",
    scope,
    segment: filters.segment,
    modelId: filters.modelId,
    variantId: filters.variantId,
    startDate: filters.startDate,
    endDate: filters.endDate,
    horizon: filters.horizon
  });
  const scopedDealerRows = await filterDealerRowsByRegion(dealerRows, filters.region, scope);
  const dealerZones = await findDealerZones(scopedDealerRows.map((row) => row.group_id), scope);
  const requiredZones = new Set([...dealerZones.values()].filter(Boolean));
  const zoneScope = hasOnlyDealerSalesScope(scope) ? { kind: "all" } : scope;
  const zoneRows = await ForecastData.findLatest({
    forecastType: "baseline",
    groupId: filters.region || (requiredZones.size === 1 ? [...requiredZones][0] : null),
    level: "zone",
    scope: zoneScope,
    segment: filters.segment,
    modelId: filters.modelId,
    variantId: filters.variantId,
    startDate: filters.startDate,
    endDate: filters.endDate,
    horizon: filters.horizon
  });
  const zoneRowsByKey = new Map(
    zoneRows
      .filter((row) => requiredZones.size === 0 || requiredZones.has(row.group_id))
      .map((row) => [buildBlendKey(row.group_id, row), row])
  );
  const dealerTotalsByZoneKey = buildDealerTotalsByZoneKey(scopedDealerRows, dealerZones);
  const weightsSummary = {
    dealer: 0,
    zone: 0,
    count: 0
  };
  const blendedRows = scopedDealerRows.map((dealerRow) => {
    const zone = dealerZones.get(dealerRow.group_id);
    const zoneRow = zone ? zoneRowsByKey.get(buildBlendKey(zone, dealerRow)) : null;

    if (!zoneRow) {
      weightsSummary.dealer += 1;
      weightsSummary.count += 1;
      return {
        ...dealerRow,
        sourceLevel: "blended",
        model_method: `${dealerRow.model_method} + dealer-only-blend`,
        model_weights: {
          dealer: 1,
          zone: 0
        }
      };
    }

    const weights = calculateBlendWeights(dealerRow.validation_mape, zoneRow.validation_mape);
    const zoneShare = calculateZoneShare(dealerRow, dealerTotalsByZoneKey, zone);
    const allocatedZone = allocateZoneRow(zoneRow, zoneShare);

    weightsSummary.dealer += weights.dealer;
    weightsSummary.zone += weights.zone;
    weightsSummary.count += 1;

    return {
      ...dealerRow,
      sourceLevel: "blended",
      forecast_units: blendNumeric(dealerRow.forecast_units, allocatedZone.forecast_units, weights),
      lower_80: blendNumeric(dealerRow.lower_80, allocatedZone.lower_80, weights),
      upper_80: blendNumeric(dealerRow.upper_80, allocatedZone.upper_80, weights),
      lower_95: blendNumeric(dealerRow.lower_95, allocatedZone.lower_95, weights),
      upper_95: blendNumeric(dealerRow.upper_95, allocatedZone.upper_95, weights),
      model_method: "inverse-MAPE weighted dealer-zone ensemble",
      validation_mae: blendNullableMetric(dealerRow.validation_mae, zoneRow.validation_mae, weights),
      validation_rmse: blendNullableMetric(dealerRow.validation_rmse, zoneRow.validation_rmse, weights),
      validation_mape: blendNullableMetric(dealerRow.validation_mape, zoneRow.validation_mape, weights),
      model_weights: weights
    };
  });
  const filteredRows = filterRowsByDateAndHorizon(blendedRows, filters);

  return {
    rows: filteredRows.map((row) => normalizeForecastRow({ endpoint: "blended" }, row)),
    modelWeights: summarizeModelWeights(weightsSummary)
  };
}

function normalizeForecastRow(config, row) {
  return {
    forecastDate: row.forecast_month,
    forecastType: config.endpoint,
    groupId: row.group_id,
    groupLabel: row.group_label,
    horizonMonth: row.horizon_month ?? null,
    level: row.level,
    method: row.model_method,
    modelId: row.model_id,
    segment: row.segment ?? null,
    sourceLevel: row.sourceLevel || row.level,
    units: Number(row.forecast_units),
    lower_80: Number(row.lower_80),
    upper_80: Number(row.upper_80),
    lower_95: Number(row.lower_95),
    upper_95: Number(row.upper_95),
    dataQuality: row.data_quality ?? "rich",
    biasCorrection: Number(row.bias_correction ?? 1),
    ...(row.model_weights ? { modelWeights: row.model_weights } : {}),
    validation: {
      mae: row.validation_mae === null ? null : Number(row.validation_mae),
      mape: row.validation_mape === null ? null : Number(row.validation_mape),
      rmse: row.validation_rmse === null ? null : Number(row.validation_rmse)
    },
    variantId: row.variant_id
  };
}

function buildBlendKey(zone, row) {
  return [
    zone,
    row.forecast_month,
    row.segment ?? "",
    row.model_id ?? "",
    row.variant_id ?? ""
  ].join("|");
}

async function findDealerZones(dealerIds, scope) {
  const uniqueDealerIds = [...new Set(dealerIds.filter(Boolean))];
  if (uniqueDealerIds.length === 0) {
    return new Map();
  }

  const conditions = ["dealer_id = ANY($1::VARCHAR[])", "is_active = TRUE"];
  const values = [uniqueDealerIds];

  appendSalesSourceScopeCondition(conditions, values, scope, "");

  const result = await pool.query(
    `
      SELECT dealer_id, region
      FROM dealers
      WHERE ${conditions.join(" AND ")}
    `,
    values
  );

  return new Map(result.rows.map((row) => [row.dealer_id, row.region]));
}

function buildDealerTotalsByZoneKey(rows, dealerZones) {
  const totals = new Map();

  for (const row of rows) {
    const zone = dealerZones.get(row.group_id);
    if (!zone) {
      continue;
    }

    const key = buildBlendKey(zone, row);
    totals.set(key, (totals.get(key) ?? 0) + Number(row.forecast_units));
  }

  return totals;
}

function calculateZoneShare(dealerRow, dealerTotalsByZoneKey, zone) {
  const total = dealerTotalsByZoneKey.get(buildBlendKey(zone, dealerRow)) ?? 0;
  if (total <= 0) {
    return 0;
  }

  return Number(dealerRow.forecast_units) / total;
}

function allocateZoneRow(zoneRow, share) {
  return {
    forecast_units: Number(zoneRow.forecast_units) * share,
    lower_80: Number(zoneRow.lower_80) * share,
    upper_80: Number(zoneRow.upper_80) * share,
    lower_95: Number(zoneRow.lower_95) * share,
    upper_95: Number(zoneRow.upper_95) * share
  };
}

function calculateBlendWeights(dealerMape, zoneMape) {
  const dealerScore = inverseMapeScore(dealerMape);
  const zoneScore = inverseMapeScore(zoneMape);
  const total = dealerScore + zoneScore;

  if (total <= 0) {
    return {
      dealer: 0.5,
      zone: 0.5
    };
  }

  return {
    dealer: roundWeight(dealerScore / total),
    zone: roundWeight(zoneScore / total)
  };
}

function inverseMapeScore(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue < 0) {
    return 1;
  }

  return 1 / Math.max(numericValue, 0.1);
}

function blendNumeric(dealerValue, zoneValue, weights) {
  return Math.max(0, Math.round(Number(dealerValue) * weights.dealer + Number(zoneValue) * weights.zone));
}

function blendNullableMetric(dealerValue, zoneValue, weights) {
  const dealerMetric = Number(dealerValue);
  const zoneMetric = Number(zoneValue);

  if (!Number.isFinite(dealerMetric) && !Number.isFinite(zoneMetric)) {
    return null;
  }

  if (!Number.isFinite(dealerMetric)) {
    return Number(zoneMetric.toFixed(2));
  }

  if (!Number.isFinite(zoneMetric)) {
    return Number(dealerMetric.toFixed(2));
  }

  return Number((dealerMetric * weights.dealer + zoneMetric * weights.zone).toFixed(2));
}

function roundWeight(value) {
  return Number(value.toFixed(4));
}

function summarizeModelWeights(summary) {
  if (summary.count === 0) {
    return {
      dealer: 0.5,
      zone: 0.5
    };
  }

  return {
    dealer: roundWeight(summary.dealer / summary.count),
    zone: roundWeight(summary.zone / summary.count)
  };
}

function filterRowsByDateAndHorizon(rows, filters) {
  const filteredByDate = rows.filter((row) => {
    if (filters.startDate && row.forecast_month < filters.startDate) {
      return false;
    }

    if (filters.endDate && row.forecast_month > filters.endDate) {
      return false;
    }

    return true;
  });

  if (!filters.horizon) {
    return filteredByDate;
  }

  const grouped = new Map();

  for (const row of filteredByDate) {
    const key = `${row.sourceLevel || row.level}:${row.group_id}:${row.segment ?? ""}:${row.model_id ?? ""}:${row.variant_id ?? ""}`;
    if (!grouped.has(key)) {
      grouped.set(key, []);
    }

    grouped.get(key).push(row);
  }

  return [...grouped.values()].flatMap((groupRows) =>
    groupRows
      .sort((left, right) => left.forecast_month.localeCompare(right.forecast_month))
      .slice(0, filters.horizon)
      .map((row, index) => ({
        ...row,
        horizon_month: index + 1
      }))
  );
}

async function filterDealerRowsByRegion(rows, region, scope) {
  if (!region) {
    return rows;
  }

  const scopedRegions = salesScopeRegions(scope);
  const scopedDealerIds = salesScopeDealerIds(scope);
  if (scopedRegions.length > 0 && !scopedRegions.includes(region)) {
    return [];
  }

  if (scopedDealerIds.length > 0 && scopedRegions.length === 0) {
    const result = await pool.query(
      `
        SELECT region
        FROM dealers
        WHERE dealer_id = ANY($1::VARCHAR[])
          AND is_active = TRUE
      `,
      [scopedDealerIds]
    );

    if (!result.rows.some((row) => row.region === region)) {
      return [];
    }
  }

  const result = await pool.query(
    `
      SELECT dealer_id
      FROM dealers
      WHERE region = $1
        AND is_active = TRUE
    `,
    [region]
  );
  const allowedDealerIds = new Set(result.rows.map((row) => row.dealer_id));

  return rows.filter((row) => allowedDealerIds.has(row.group_id));
}

function aggregateToNationalRows(rows) {
  const groups = new Map();

  for (const row of rows) {
    const key = `${row.forecast_month}:${row.segment ?? ""}:${row.model_id ?? ""}:${row.variant_id ?? ""}`;
    if (!groups.has(key)) {
      groups.set(key, {
        ...row,
        group_id: "NATIONAL",
        group_label: "National",
        level: "national",
        forecast_units: 0,
        lower_80: 0,
        upper_80: 0,
        lower_95: 0,
        upper_95: 0,
        data_quality_values: [],
        bias_correction_values: []
      });
    }

    const group = groups.get(key);
    group.forecast_units += Number(row.forecast_units);
    group.lower_80 += Number(row.lower_80);
    group.upper_80 += Number(row.upper_80);
    group.lower_95 += Number(row.lower_95);
    group.upper_95 += Number(row.upper_95);
    group.data_quality_values.push(row.data_quality);
    group.bias_correction_values.push(Number(row.bias_correction ?? 1));
  }

  return [...groups.values()]
    .map(({ data_quality_values, bias_correction_values, ...row }) => ({
      ...row,
      data_quality: summarizeDataQuality(data_quality_values),
      bias_correction: averageBiasCorrection(bias_correction_values)
    }))
    .sort((left, right) => left.forecast_month.localeCompare(right.forecast_month));
}

function aggregateToRegionalRows(rows) {
  const groups = new Map();

  for (const row of rows) {
    const key = `${row.group_id}:${row.forecast_month}:${row.segment ?? ""}:${row.model_id ?? ""}:${row.variant_id ?? ""}`;
    if (!groups.has(key)) {
      groups.set(key, {
        ...row,
        level: "regional",
        forecast_units: 0,
        lower_80: 0,
        upper_80: 0,
        lower_95: 0,
        upper_95: 0,
        data_quality_values: [],
        bias_correction_values: []
      });
    }

    const group = groups.get(key);
    group.forecast_units += Number(row.forecast_units);
    group.lower_80 += Number(row.lower_80);
    group.upper_80 += Number(row.upper_80);
    group.lower_95 += Number(row.lower_95);
    group.upper_95 += Number(row.upper_95);
    group.data_quality_values.push(row.data_quality);
    group.bias_correction_values.push(Number(row.bias_correction ?? 1));
  }

  return [...groups.values()].map(({ data_quality_values, bias_correction_values, ...row }) => ({
    ...row,
    data_quality: summarizeDataQuality(data_quality_values),
    bias_correction: averageBiasCorrection(bias_correction_values)
  })).sort((left, right) => {
    if (left.group_label === right.group_label) {
      return left.forecast_month.localeCompare(right.forecast_month);
    }

    return left.group_label.localeCompare(right.group_label);
  });
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

function averageBiasCorrection(values) {
  const finiteValues = values.filter(Number.isFinite);

  if (finiteValues.length === 0) {
    return 1;
  }

  return Number((finiteValues.reduce((sum, value) => sum + value, 0) / finiteValues.length).toFixed(6));
}

function paginateRows(rows, page, pageSize) {
  const offset = (page - 1) * pageSize;
  const totalRecords = rows.length;
  const totalPages = Math.max(Math.ceil(totalRecords / pageSize), 1);

  return {
    data: rows.slice(offset, offset + pageSize),
    pagination: {
      page,
      pageSize,
      totalPages,
      totalRecords
    }
  };
}

function createHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}
