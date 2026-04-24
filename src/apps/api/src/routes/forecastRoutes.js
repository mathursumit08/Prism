import { Router } from "express";
import { ForecastData, ForecastRun } from "../data/models/index.js";
import { ForecastAdminService } from "../services/forecastAdminService.js";
import { pool } from "../db.js";

const router = Router();
const allowedLevels = new Set(["dealer", "state", "zone"]);

/**
 * Groups flat forecast table rows into the API response shape per hierarchy group.
 */
function groupForecastRows(rows) {
  const groups = new Map();

  for (const row of rows) {
    const key = `${row.level}:${row.group_id}:${row.model_id ?? ""}:${row.variant_id ?? ""}`;

    if (!groups.has(key)) {
      groups.set(key, {
        level: row.level,
        groupId: row.group_id,
        groupLabel: row.group_label,
        modelId: row.model_id,
        variantId: row.variant_id,
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
      unitsSold: Number(row.forecast_units)
    });
  }

  return [...groups.values()];
}

function groupActualRows(rows) {
  const groups = new Map();

  for (const row of rows) {
    const key = `${row.level}:${row.group_id}`;

    if (!groups.has(key)) {
      groups.set(key, {
        level: row.level,
        groupId: row.group_id,
        groupLabel: row.group_label,
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

async function findActualRows({ level, groupId, segment, modelId, variantId }) {
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
  const conditions = [];

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

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const result = await pool.query(
    `
      SELECT
        $1::VARCHAR AS level,
        ${config.id} AS group_id,
        ${config.label} AS group_label,
        TO_CHAR(m.month, 'YYYY-MM-01') AS month,
        SUM(m.units_sold)::INTEGER AS units_sold
      FROM monthly_sales_data m
      JOIN dealers d ON d.dealer_id = m.dealer_id
      JOIN vehicle_models vm ON vm.model_id = m.model_id
      ${where}
      GROUP BY ${config.id}, ${config.label}, m.month
      ORDER BY ${config.label}, m.month
    `,
    [resolvedLevel, ...values]
  );

  return result.rows;
}

/**
 * Returns the latest completed stored baseline forecast filtered by query string.
 */
router.get("/baseline", async (request, response) => {
  const level = request.query.level;
  const groupId = request.query.groupId || request.query.dealerId;
  const segment = request.query.segment;
  const modelId = request.query.modelId || request.query.ModelId;
  const variantId = request.query.variantId || request.query.VariantId;

  if (level && !allowedLevels.has(level)) {
    response.status(400).json({
      ok: false,
      error: `Unsupported forecast level "${level}"`
    });
    return;
  }

  try {
    const latestRun = await ForecastRun.findLatestCompleted();

    if (!latestRun) {
      response.status(404).json({
        ok: false,
        error: "No completed baseline forecast run found"
      });
      return;
    }

    const rows = await ForecastData.findLatest({
      level,
      groupId,
      segment,
      modelId,
      variantId
    });

    response.json({
      ok: true,
      runId: latestRun.run_id,
      horizon: latestRun.horizon_months,
      completedAt: latestRun.completed_at,
      filters: {
        level: level || "all",
        groupId: groupId || null,
        segment: segment || null,
        modelId: modelId || null,
        variantId: variantId || null
      },
      series: groupForecastRows(rows)
    });
  } catch (error) {
    response.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

router.get("/actuals", async (request, response) => {
  const level = request.query.level;
  const groupId = request.query.groupId || request.query.dealerId;
  const segment = request.query.segment;
  const modelId = request.query.modelId || request.query.ModelId;
  const variantId = request.query.variantId || request.query.VariantId;

  if (level && !allowedLevels.has(level)) {
    response.status(400).json({
      ok: false,
      error: `Unsupported forecast level "${level}"`
    });
    return;
  }

  try {
    const rows = await findActualRows({
      level,
      groupId,
      segment,
      modelId,
      variantId
    });

    response.json({
      ok: true,
      filters: {
        level: level || "dealer",
        groupId: groupId || null,
        segment: segment || null,
        modelId: modelId || null,
        variantId: variantId || null
      },
      series: groupActualRows(rows)
    });
  } catch (error) {
    response.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

router.get("/admin/status", async (_request, response) => {
  try {
    const status = await ForecastAdminService.getStatus();
    response.json({
      ok: true,
      ...status
    });
  } catch (error) {
    response.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

router.post("/admin/clear", async (_request, response) => {
  try {
    const deletedRows = await ForecastAdminService.clearForecastData();
    const status = await ForecastAdminService.getStatus();

    response.json({
      ok: true,
      deletedRows,
      ...status
    });
  } catch (error) {
    const statusCode = error.code === "RUN_IN_PROGRESS" ? 409 : 500;
    response.status(statusCode).json({
      ok: false,
      error: error.message
    });
  }
});

router.post("/admin/regenerate", async (request, response) => {
  try {
    const generation = await ForecastAdminService.regenerateForecast({
      horizon: request.body?.horizon
    });

    response.status(202).json({
      ok: true,
      generation
    });
  } catch (error) {
    const statusCode = error.code === "INVALID_HORIZON" ? 400 : error.code === "RUN_IN_PROGRESS" ? 409 : 500;
    response.status(statusCode).json({
      ok: false,
      error: error.message
    });
  }
});

export default router;
