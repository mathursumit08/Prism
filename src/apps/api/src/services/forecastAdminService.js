import { ForecastData, ForecastEventCalendar, ForecastRun } from "../data/models/index.js";
import { runForecastWorker } from "../workers/forecastWorker.js";

const FORECAST_TYPE = "baseline";
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
    errorMessage: row.error_message
  };
}

function normalizeEvent(event) {
  return {
    eventCode: event.event_code,
    eventName: event.event_name,
    startMonth: Number(event.start_month),
    endMonth: Number(event.end_month),
    upliftPct: Number(event.uplift_pct),
    isActive: Boolean(event.is_active)
  };
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
    const [lastSuccessfulRun, latestRun, lastFailedRun, storedForecastRows, activeEvents] = await Promise.all([
      ForecastRun.findLatestCompleted({ forecastType: FORECAST_TYPE }),
      ForecastRun.findLatest({ forecastType: FORECAST_TYPE }),
      ForecastRun.findLatestFailed({ forecastType: FORECAST_TYPE }),
      ForecastData.countByForecastType(FORECAST_TYPE),
      ForecastEventCalendar.findActive({ forecastType: FORECAST_TYPE })
    ]);

    return {
      forecastType: FORECAST_TYPE,
      allowedHorizons: this.getAllowedHorizons(),
      generation: buildGenerationSnapshot(),
      lastSuccessfulRun: normalizeRun(lastSuccessfulRun),
      latestRun: normalizeRun(latestRun),
      lastFailedRun: normalizeRun(lastFailedRun),
      storedForecastRows,
      activeEvents: activeEvents.map(normalizeEvent)
    };
  },

  async clearForecastData() {
    if (generationState.running) {
      const error = new Error("Forecast regeneration is currently running. Please wait for it to finish.");
      error.code = "RUN_IN_PROGRESS";
      throw error;
    }

    return ForecastData.clearByForecastType(FORECAST_TYPE);
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
