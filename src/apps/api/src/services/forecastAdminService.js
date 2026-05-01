import { ForecastData, ForecastEventCalendar, ForecastRun } from "../data/models/index.js";
import { ForecastCacheService } from "./forecastCacheService.js";
import { runForecastWorker } from "../workers/forecastWorker.js";

const FORECAST_TYPE = "baseline";
const DEFAULT_HORIZON_MONTHS = 6;
const allowedHorizons = new Set([6, 12, 24]);

const generationState = {
  running: false,
  stage: "idle",
  stageLabel: "Idle",
  message: "No forecast regeneration is active.",
  horizon: null,
  runId: null,
  startedAt: null,
  completedAt: null,
  failedAt: null,
  error: "",
  processedScopes: 0,
  totalScopes: 0,
  inserted: 0,
  removed: 0
};

function updateGenerationState(patch) {
  Object.assign(generationState, patch);
}

function resetGenerationState(horizon) {
  updateGenerationState({
    running: true,
    stage: "initializing",
    stageLabel: "Initializing",
    message: "Preparing forecast regeneration.",
    horizon,
    runId: null,
    startedAt: new Date().toISOString(),
    completedAt: null,
    failedAt: null,
    error: "",
    processedScopes: 0,
    totalScopes: 0,
    inserted: 0,
    removed: 0
  });
}

function normalizeRun(row) {
  if (!row) {
    return null;
  }

  return {
    runId: row.run_id,
    forecastType: row.forecast_type,
    horizonMonths: row.horizon_months,
    status: row.status,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    errorMessage: row.error_message,
    calibration: normalizeCalibration(row)
  };
}

function normalizeCalibration(row) {
  const coverage80 = row.coverage_80 === null || row.coverage_80 === undefined ? null : Number(row.coverage_80);
  const coverage95 = row.coverage_95 === null || row.coverage_95 === undefined ? null : Number(row.coverage_95);

  return {
    coverage80,
    coverage95,
    target80WithinTolerance: coverage80 === null ? null : Math.abs(coverage80 - 80) <= 2,
    target95WithinTolerance: coverage95 === null ? null : Math.abs(coverage95 - 95) <= 2,
    sampleCount: Number(row.calibration_sample_count || 0),
    avgWidth80: row.avg_width_80 === null || row.avg_width_80 === undefined ? null : Number(row.avg_width_80),
    avgWidth95: row.avg_width_95 === null || row.avg_width_95 === undefined ? null : Number(row.avg_width_95),
    horizonWidths: Array.isArray(row.horizon_widths) ? row.horizon_widths : []
  };
}

function normalizeEvent(event) {
  return {
    eventId: event.event_id,
    eventCode: event.event_code,
    eventName: event.event_name,
    eventType: event.event_type,
    scope: event.scope,
    scopeValue: event.scope_value,
    startDate: event.start_date,
    endDate: event.end_date,
    upliftPct: Number(event.uplift_pct),
    isActive: Boolean(event.is_active)
  };
}

function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function addMonths(date, months) {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);

  return next;
}

function filterUpcomingEvents(events, horizonMonths) {
  const today = formatDate(new Date());
  const horizonEnd = formatDate(addMonths(new Date(), horizonMonths));

  return events.filter((event) => event.end_date >= today && event.start_date <= horizonEnd);
}

function buildGenerationSnapshot() {
  return {
    running: generationState.running,
    stage: generationState.stage,
    stageLabel: generationState.stageLabel,
    message: generationState.message,
    horizon: generationState.horizon,
    runId: generationState.runId,
    startedAt: generationState.startedAt,
    completedAt: generationState.completedAt,
    failedAt: generationState.failedAt,
    error: generationState.error,
    processedScopes: generationState.processedScopes,
    totalScopes: generationState.totalScopes,
    inserted: generationState.inserted,
    removed: generationState.removed
  };
}

export const ForecastAdminService = {
  getAllowedHorizons() {
    return [...allowedHorizons];
  },

  isGenerationRunning() {
    return generationState.running;
  },

  async getStatus() {
    const [lastSuccessfulRun, latestRun, lastFailedRun, storedForecastRows] = await Promise.all([
      ForecastRun.findLatestCompleted({ forecastType: FORECAST_TYPE }),
      ForecastRun.findLatest({ forecastType: FORECAST_TYPE }),
      ForecastRun.findLatestFailed({ forecastType: FORECAST_TYPE }),
      ForecastData.countByForecastType(FORECAST_TYPE)
    ]);
    const horizonMonths =
      generationState.horizon || lastSuccessfulRun?.horizon_months || DEFAULT_HORIZON_MONTHS;
    const activeEvents = filterUpcomingEvents(
      await ForecastEventCalendar.findActive({ forecastType: FORECAST_TYPE }),
      horizonMonths
    );

    return {
      forecastType: FORECAST_TYPE,
      allowedHorizons: this.getAllowedHorizons(),
      generation: buildGenerationSnapshot(),
      lastSuccessfulRun: normalizeRun(lastSuccessfulRun),
      latestRun: normalizeRun(latestRun),
      lastFailedRun: normalizeRun(lastFailedRun),
      calibration: lastSuccessfulRun ? normalizeCalibration(lastSuccessfulRun) : null,
      storedForecastRows,
      activeEvents: activeEvents.map(normalizeEvent)
    };
  },

  async clearFutureForecastData() {
    if (generationState.running) {
      const error = new Error("Forecast regeneration is currently running. Please wait for it to finish.");
      error.code = "RUN_IN_PROGRESS";
      throw error;
    }

    const deleted = await ForecastData.clearFutureByForecastType(FORECAST_TYPE);
    ForecastCacheService.clear();
    return deleted;
  },

  async regenerateForecast({ horizon }) {
    const numericHorizon = Number(horizon);
    if (!allowedHorizons.has(numericHorizon)) {
      const error = new Error(`Unsupported horizon "${horizon}". Allowed values are 6, 12, and 24 months.`);
      error.code = "INVALID_HORIZON";
      throw error;
    }

    if (generationState.running) {
      const error = new Error("A forecast regeneration is already in progress.");
      error.code = "RUN_IN_PROGRESS";
      throw error;
    }

    resetGenerationState(numericHorizon);

    runForecastWorker({
      horizon: numericHorizon,
      onProgress(progress) {
        updateGenerationState(progress);
      }
    })
      .then((result) => {
        updateGenerationState({
          running: false,
          stage: "finished",
          stageLabel: "Finished successfully",
          message: "Forecast regeneration finished successfully.",
          completedAt: new Date().toISOString(),
          inserted: result.inserted ?? generationState.inserted,
          removed: result.removed ?? generationState.removed
        });
      })
      .catch((error) => {
        updateGenerationState({
          running: false,
          stage: "failed",
          stageLabel: "Failed",
          message: error.message || "Forecast regeneration failed.",
          failedAt: new Date().toISOString(),
          error: error.message || "Forecast regeneration failed."
        });
      })
      .finally(() => {
        return null;
      });

    return buildGenerationSnapshot();
  }
};
