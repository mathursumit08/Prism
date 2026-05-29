import { DomainForecastData, ForecastData, ForecastEventCalendar, ForecastRun } from "../data/models/index.js";
import { ForecastCacheService } from "./forecastCacheService.js";
import { runForecastWorker, runPartsForecastWorker, runServiceForecastWorker, runSlaForecastWorker, runWarrantyForecastWorker } from "../workers/forecastWorker.js";

const FORECAST_TYPE = "baseline";
const PARTS_FORECAST_TYPE = "demand";
const SERVICE_FORECAST_TYPE = "order_volume";
const WARRANTY_FORECAST_TYPE = "warranty_returns";
const SLA_FORECAST_TYPE = "sla_breach_risk";
const DEFAULT_HORIZON_MONTHS = 6;
const allowedHorizons = new Set([6, 12, 24]);
const domainConfigs = {
  sales: {
    key: "sales",
    domain: "Sales",
    forecastType: FORECAST_TYPE,
    label: "Sales",
    run: runForecastWorker,
    countRows: () => ForecastData.countByForecastType(FORECAST_TYPE),
    clearRows: () => ForecastData.clearFutureByForecastType(FORECAST_TYPE)
  },
  parts: {
    key: "parts",
    domain: "Parts",
    forecastType: PARTS_FORECAST_TYPE,
    label: "Parts",
    run: runPartsForecastWorker,
    countRows: () => DomainForecastData.count("parts", PARTS_FORECAST_TYPE),
    clearRows: () => DomainForecastData.clearFuture("parts", PARTS_FORECAST_TYPE)
  },
  service: {
    key: "service",
    domain: "Service",
    forecastType: SERVICE_FORECAST_TYPE,
    label: "Service",
    run: runServiceForecastWorker,
    countRows: () => DomainForecastData.count("service", SERVICE_FORECAST_TYPE),
    clearRows: () => DomainForecastData.clearFuture("service", SERVICE_FORECAST_TYPE)
  },
  warranty: {
    key: "warranty",
    domain: "Warranty",
    forecastType: WARRANTY_FORECAST_TYPE,
    label: "Warranty",
    run: runWarrantyForecastWorker,
    countRows: () => DomainForecastData.count("warranty", WARRANTY_FORECAST_TYPE),
    clearRows: () => DomainForecastData.clearFuture("warranty", WARRANTY_FORECAST_TYPE)
  },
  sla: {
    key: "sla",
    domain: "SLA",
    forecastType: SLA_FORECAST_TYPE,
    label: "SLA",
    run: runSlaForecastWorker,
    countRows: () => DomainForecastData.count("sla", SLA_FORECAST_TYPE),
    clearRows: () => DomainForecastData.clearFuture("sla", SLA_FORECAST_TYPE)
  }
};

// This in-memory snapshot feeds the Manage Forecast screen while the worker is
// running. Durable run history is still written to forecast_runs by the worker.
function createGenerationState() {
  return {
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
}

const generationStates = Object.fromEntries(
  Object.keys(domainConfigs).map((domain) => [domain, createGenerationState()])
);

function getDomainConfig(domain = "sales") {
  const config = domainConfigs[String(domain || "sales").toLowerCase()];
  if (!config) {
    const error = new Error(`Unsupported forecast domain "${domain}"`);
    error.code = "INVALID_DOMAIN";
    throw error;
  }

  return config;
}

function getGenerationState(domain) {
  return generationStates[String(domain || "sales").toLowerCase()] ?? generationStates.sales;
}

function updateGenerationState(domain, patch) {
  Object.assign(getGenerationState(domain), patch);
}

function resetGenerationState(domain, horizon) {
  updateGenerationState(domain, {
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
    forecastDomain: row.forecast_domain,
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
    forecastDomain: event.forecast_domain,
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

function buildGenerationSnapshot(domain, latestRun = null) {
  const generationState = getGenerationState(domain);

  if (!generationState.running && latestRun?.status === "running") {
    return {
      running: false,
      stage: "failed",
      stageLabel: "Interrupted",
      message: "The latest forecast run started but did not report completion. The worker process may have exited abruptly.",
      horizon: latestRun.horizon_months,
      runId: latestRun.run_id,
      startedAt: latestRun.started_at,
      completedAt: null,
      failedAt: null,
      error: "The latest forecast run is still marked running in forecast_runs.",
      processedScopes: 0,
      totalScopes: 0,
      inserted: 0,
      removed: 0
    };
  }

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
    return Object.values(generationStates).some((state) => state.running);
  },

  async getStatus() {
    return this.getDomainStatus("sales");
  },

  async getDomainStatus(domain = "sales") {
    const config = getDomainConfig(domain);
    const [lastSuccessfulRun, latestRun, lastFailedRun, storedForecastRows] = await Promise.all([
      ForecastRun.findLatestCompleted({ forecastDomain: config.domain, forecastType: config.forecastType }),
      ForecastRun.findLatest({ forecastDomain: config.domain, forecastType: config.forecastType }),
      ForecastRun.findLatestFailed({ forecastDomain: config.domain, forecastType: config.forecastType }),
      config.countRows()
    ]);
    const generationState = getGenerationState(domain);
    const horizonMonths =
      generationState.horizon || lastSuccessfulRun?.horizon_months || DEFAULT_HORIZON_MONTHS;
    const activeEvents = filterUpcomingEvents(
      await ForecastEventCalendar.findActive({
        forecastDomain: config.domain,
        forecastType: config.forecastType
      }),
      horizonMonths
    );

    return {
      forecastDomain: config.domain,
      forecastType: config.forecastType,
      forecastLabel: config.label,
      allowedHorizons: this.getAllowedHorizons(),
      generation: buildGenerationSnapshot(domain, latestRun),
      lastSuccessfulRun: normalizeRun(lastSuccessfulRun),
      latestRun: normalizeRun(latestRun),
      lastFailedRun: normalizeRun(lastFailedRun),
      calibration: lastSuccessfulRun ? normalizeCalibration(lastSuccessfulRun) : null,
      storedForecastRows,
      activeEvents: activeEvents.map(normalizeEvent)
    };
  },

  async clearFutureForecastData() {
    return this.clearFutureForecastDataForDomain("sales");
  },

  async clearFutureForecastDataForDomain(domain = "sales") {
    const config = getDomainConfig(domain);
    const generationState = getGenerationState(domain);
    if (generationState.running) {
      const error = new Error("Forecast regeneration is currently running. Please wait for it to finish.");
      error.code = "RUN_IN_PROGRESS";
      throw error;
    }

    const deleted = await config.clearRows();
    ForecastCacheService.clear();
    return deleted;
  },

  async regenerateForecast({ horizon }) {
    return this.regenerateForecastForDomain({ domain: "sales", horizon });
  },

  async regenerateForecastForDomain({ domain = "sales", horizon }) {
    const config = getDomainConfig(domain);
    const numericHorizon = Number(horizon);
    if (!allowedHorizons.has(numericHorizon)) {
      const error = new Error(`Unsupported horizon "${horizon}". Allowed values are 6, 12, and 24 months.`);
      error.code = "INVALID_HORIZON";
      throw error;
    }

    const generationState = getGenerationState(domain);
    if (generationState.running) {
      const error = new Error("A forecast regeneration is already in progress.");
      error.code = "RUN_IN_PROGRESS";
      throw error;
    }

    resetGenerationState(domain, numericHorizon);

    // Regeneration runs in the background so the API can return immediately and
    // the UI can poll getStatus for live progress.
    config.run({
      horizon: numericHorizon,
      onProgress(progress) {
        updateGenerationState(domain, progress);
      }
    })
      .then((result) => {
        updateGenerationState(domain, {
          running: false,
          stage: "finished",
          stageLabel: "Finished successfully",
          message: `${config.label} forecast regeneration finished successfully.`,
          completedAt: new Date().toISOString(),
          inserted: result.inserted ?? generationState.inserted,
          removed: result.removed ?? generationState.removed
        });
      })
      .catch((error) => {
        updateGenerationState(domain, {
          running: false,
          stage: "failed",
          stageLabel: "Failed",
          message: error.message || `${config.label} forecast regeneration failed.`,
          failedAt: new Date().toISOString(),
          error: error.message || `${config.label} forecast regeneration failed.`
        });
      })
      .finally(() => {
        return null;
      });

    return buildGenerationSnapshot(domain);
  }
};
