import { Router } from "express";
import { ForecastData, ForecastRun } from "../data/models/index.js";

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

/**
 * Returns the latest completed stored baseline forecast filtered by query string.
 */
router.get("/baseline", async (request, response) => {
  const level = request.query.level;
  const groupId = request.query.groupId || request.query.dealerId;
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

export default router;
