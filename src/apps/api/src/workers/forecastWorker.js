import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import { pool } from "../db.js";
import { buildBaselineForecast } from "../forecasting/baselineForecast.js";
import { ForecastData, ForecastEventCalendar, ForecastRun } from "../data/models/index.js";
import { ForecastCacheService } from "../services/forecastCacheService.js";

dotenv.config();

const FORECAST_TYPE = "baseline";
const DEFAULT_HORIZON = 6;
const MAX_BATCH_SIZE = 500;
const workerLockId = 46013520;
const currentFile = fileURLToPath(import.meta.url);

/**
 * Builds a stable forecast key used to compare current rows against a rerun result set.
 */
function buildForecastKey({
  forecastType,
  level,
  groupId,
  segment,
  modelId,
  variantId,
  forecastMonth
}) {
  return [
    forecastType,
    level,
    groupId,
    segment ?? "",
    modelId ?? "",
    variantId ?? "",
    forecastMonth
  ].join("|");
}

/**
 * Returns the month number for a YYYY-MM-01 string using UTC.
 */
function getMonthNumber(month) {
  return new Date(`${month}T00:00:00.000Z`).getUTCMonth() + 1;
}

/**
 * Checks whether a month falls inside an inclusive recurring festive window.
 */
function monthFallsInWindow(monthNumber, startMonth, endMonth) {
  if (startMonth <= endMonth) {
    return monthNumber >= startMonth && monthNumber <= endMonth;
  }

  return monthNumber >= startMonth || monthNumber <= endMonth;
}

/**
 * Returns the active festive-event rules that apply to the provided forecast month.
 */
function findMatchingEvents(month, eventCalendar) {
  const monthNumber = getMonthNumber(month);

  return eventCalendar.filter((event) =>
    monthFallsInWindow(monthNumber, Number(event.start_month), Number(event.end_month))
  );
}

/**
 * Applies the configured festive uplift to a single forecast point.
 */
function applyPointUplift(point, eventCalendar) {
  const matchingEvents = findMatchingEvents(point.month, eventCalendar);
  const totalUpliftPct = matchingEvents.reduce((sum, event) => sum + Number(event.uplift_pct), 0);
  const upliftFactor = 1 + totalUpliftPct / 100;
  const upliftedUnitsSold = Math.max(0, Math.round(point.unitsSold * upliftFactor));

  return {
    ...point,
    unitsSold: upliftedUnitsSold,
    lower80: Math.max(0, Math.round((point.lower80 ?? point.unitsSold) * upliftFactor)),
    upper80: Math.max(0, Math.round((point.upper80 ?? point.unitsSold) * upliftFactor)),
    lower95: Math.max(0, Math.round((point.lower95 ?? point.unitsSold) * upliftFactor)),
    upper95: Math.max(0, Math.round((point.upper95 ?? point.unitsSold) * upliftFactor))
  };
}

/**
 * Applies festive uplift rules to dealer-level forecast series.
 */
function applyEventUpliftsToDealerSeries(dealerSeries, eventCalendar) {
  if (eventCalendar.length === 0) {
    return dealerSeries;
  }

  return dealerSeries.map((series) => ({
    ...series,
    method: `${series.method} + event-uplift`,
    forecast: series.forecast.map((point) => applyPointUplift(point, eventCalendar))
  }));
}

/**
 * Rolls adjusted dealer forecasts up to state or zone level while preserving totals.
 */
function aggregateAdjustedDealers(dealerSeries, level) {
  const grouped = new Map();

  for (const dealer of dealerSeries) {
    const groupId = level === "state" ? dealer.state : dealer.zone;

    if (!grouped.has(groupId)) {
      grouped.set(groupId, {
        level,
        groupId,
        groupLabel: groupId,
        method: "aggregated-from-dealers + event-uplift",
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
          upper95: 0
        }))
      });
    }

    const aggregate = grouped.get(groupId);

    dealer.history.forEach((point, index) => {
      aggregate.history[index].unitsSold += point.unitsSold;
    });

    dealer.forecast.forEach((point, index) => {
      aggregate.forecast[index].unitsSold += point.unitsSold;
      aggregate.forecast[index].lower80 += point.lower80 ?? point.unitsSold;
      aggregate.forecast[index].upper80 += point.upper80 ?? point.unitsSold;
      aggregate.forecast[index].lower95 += point.lower95 ?? point.unitsSold;
      aggregate.forecast[index].upper95 += point.upper95 ?? point.unitsSold;
    });
  }

  return [...grouped.values()];
}

function summarizeCalibration(records) {
  const calibrationRecords = records.filter((record) => Number.isFinite(record.coverage80) && Number.isFinite(record.coverage95));

  if (calibrationRecords.length === 0) {
    return {
      coverage80: null,
      coverage95: null,
      sampleCount: 0,
      avgWidth80: null,
      avgWidth95: null,
      horizonWidths: []
    };
  }

  const totalSamples = calibrationRecords.reduce((sum, record) => sum + record.calibrationSampleCount, 0);
  const weightedAverage = (key) => {
    if (totalSamples === 0) {
      return null;
    }

    return Number(
      (
        calibrationRecords.reduce((sum, record) => sum + Number(record[key]) * record.calibrationSampleCount, 0) /
        totalSamples
      ).toFixed(2)
    );
  };
  const horizonGroups = new Map();

  for (const record of calibrationRecords) {
    if (!horizonGroups.has(record.horizonMonth)) {
      horizonGroups.set(record.horizonMonth, {
        horizonMonth: record.horizonMonth,
        width80: [],
        width95: [],
        sampleCount: 0
      });
    }

    const group = horizonGroups.get(record.horizonMonth);
    group.width80.push(record.upper80 - record.lower80);
    group.width95.push(record.upper95 - record.lower95);
    group.sampleCount += record.calibrationSampleCount;
  }

  return {
    coverage80: weightedAverage("coverage80"),
    coverage95: weightedAverage("coverage95"),
    sampleCount: totalSamples,
    avgWidth80: Number(mean(calibrationRecords.map((record) => record.upper80 - record.lower80)).toFixed(2)),
    avgWidth95: Number(mean(calibrationRecords.map((record) => record.upper95 - record.lower95)).toFixed(2)),
    horizonWidths: [...horizonGroups.values()]
      .sort((left, right) => left.horizonMonth - right.horizonMonth)
      .map((group) => ({
        horizonMonth: group.horizonMonth,
        width80: Number(mean(group.width80).toFixed(2)),
        width95: Number(mean(group.width95).toFixed(2)),
        sampleCount: group.sampleCount
      }))
  };
}

function mean(values) {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * Builds the final dealer, state, and zone output after festive uplifts are applied.
 */
function buildAdjustedForecastLevels(dealerSeries, eventCalendar) {
  const adjustedDealers = applyEventUpliftsToDealerSeries(dealerSeries, eventCalendar);

  return [
    {
      level: "dealer",
      series: adjustedDealers
    },
    {
      level: "state",
      series: aggregateAdjustedDealers(adjustedDealers, "state")
    },
    {
      level: "zone",
      series: aggregateAdjustedDealers(adjustedDealers, "zone")
    }
  ];
}

/**
 * Reads the configured horizon and clamps it to the supported 1-24 month range.
 */
function parseHorizon(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_HORIZON;
  }

  return Math.min(Math.max(Math.trunc(parsed), 1), 24);
}

function reportProgress(onProgress, progress) {
  if (typeof onProgress === "function") {
    onProgress(progress);
  }
}

/**
 * Calculates the delay from now until the next local 12:00 AM boundary.
 */
function nextMidnightDelay(now = new Date()) {
  const next = new Date(now);
  next.setHours(24, 0, 0, 0);
  return next.getTime() - now.getTime();
}

/**
 * Builds all forecast scopes: overall, model-level, and variant-level forecasts.
 */
async function fetchForecastScopes(db = pool) {
  const [segmentsResult, modelsResult, variantsResult] = await Promise.all([
    db.query(`
      SELECT DISTINCT segment
      FROM vehicle_models
      ORDER BY segment
    `),
    db.query(`
      SELECT model_id, segment
      FROM vehicle_models
      ORDER BY segment, model_id
    `),
    db.query(`
      SELECT vv.model_id, vv.variant_id, vm.segment
      FROM vehicle_variants vv
      JOIN vehicle_models vm ON vm.model_id = vv.model_id
      ORDER BY vm.segment, vv.model_id, vv.variant_id
    `)
  ]);

  return [
    {
      segment: null,
      modelId: null,
      variantId: null
    },
    ...segmentsResult.rows.map((row) => ({
      segment: row.segment,
      modelId: null,
      variantId: null
    })),
    ...modelsResult.rows.map((row) => ({
      segment: row.segment,
      modelId: row.model_id,
      variantId: null
    })),
    ...variantsResult.rows.map((row) => ({
      segment: row.segment,
      modelId: row.model_id,
      variantId: row.variant_id
    }))
  ];
}

/**
 * Loads all active festive-event uplift rules used during the current refresh.
 */
async function fetchEventCalendar(db = pool) {
  return ForecastEventCalendar.findActive(
    {
      forecastType: FORECAST_TYPE
    },
    db
  );
}

/**
 * Converts nested forecast output into rows that match the forecast_data table.
 */
function flattenForecast({ runId, scope, forecast }) {
  const records = [];

  for (const levelResult of forecast.levels) {
    for (const series of levelResult.series) {
      for (const point of series.forecast) {
        const horizonMonth = series.forecast.indexOf(point) + 1;
        records.push({
          runId,
          forecastType: FORECAST_TYPE,
          level: series.level,
          groupId: series.groupId,
          groupLabel: series.groupLabel,
          segment: scope.segment,
          modelId: scope.modelId,
          variantId: scope.variantId,
          forecastMonth: point.month,
          forecastUnits: point.unitsSold,
          lower80: point.lower80 ?? point.unitsSold,
          upper80: point.upper80 ?? point.unitsSold,
          lower95: point.lower95 ?? point.unitsSold,
          upper95: point.upper95 ?? point.unitsSold,
          horizonMonth,
          modelMethod: series.method,
          validationMae: series.validation.mae,
          validationRmse: series.validation.rmse,
          validationMape: series.validation.mape,
          coverage80: series.calibration?.coverage80 ?? null,
          coverage95: series.calibration?.coverage95 ?? null,
          calibrationSampleCount: series.calibration?.sampleCount ?? 0
        });
      }
    }
  }

  return records;
}

/**
 * Inserts forecast rows in chunks to keep SQL statements at a manageable size.
 */
async function insertInBatches(records, db = pool) {
  let inserted = 0;

  for (let index = 0; index < records.length; index += MAX_BATCH_SIZE) {
    inserted += await ForecastData.insertMany(records.slice(index, index + MAX_BATCH_SIZE), db);
  }

  return inserted;
}

/**
 * Deletes any previously stored rows that are no longer present in the current rerun output.
 */
async function removeIrrelevantRows(records, db) {
  const currentKeys = new Set(
    records.map((record) =>
      buildForecastKey({
        forecastType: record.forecastType,
        level: record.level,
        groupId: record.groupId,
        segment: record.segment,
        modelId: record.modelId,
        variantId: record.variantId,
        forecastMonth: record.forecastMonth
      })
    )
  );
  const existingRows = await ForecastData.findKeysByForecastType(FORECAST_TYPE, db);
  const idsToDelete = existingRows
    .filter(
      (row) =>
        !currentKeys.has(
          buildForecastKey({
            forecastType: row.forecast_type,
            level: row.level,
            groupId: row.group_id,
            segment: row.segment,
            modelId: row.model_id,
            variantId: row.variant_id,
            forecastMonth: row.forecast_month
          })
        )
    )
    .map((row) => row.forecast_id);

  return ForecastData.deleteByIds(idsToDelete, db);
}

/**
 * Runs one complete forecast generation cycle and stores the results in Postgres.
 */
export async function runForecastWorker({
  horizon = parseHorizon(process.env.FORECAST_HORIZON_MONTHS),
  onProgress
} = {}) {
  const client = await pool.connect();
  let run = null;

  reportProgress(onProgress, {
    stage: "initializing",
    stageLabel: "Initializing",
    message: `Preparing ${horizon}-month forecast regeneration.`,
    horizon
  });

  try {
    const lockResult = await client.query("SELECT pg_try_advisory_lock($1) AS locked", [workerLockId]);
    if (!lockResult.rows[0]?.locked) {
      console.log("Forecast worker skipped because another run is already active");
      reportProgress(onProgress, {
        running: false,
        stage: "failed",
        stageLabel: "Failed",
        message: "Another forecast generation is already active.",
        error: "Another forecast generation is already active."
      });
      return {
        skipped: true,
        reason: "lock-not-acquired"
      };
    }

    await client.query("BEGIN");

    run = await ForecastRun.create(
      {
        forecastType: FORECAST_TYPE,
        horizonMonths: horizon
      },
      client
    );
    reportProgress(onProgress, {
      stage: "loading-source-data",
      stageLabel: "Loading source data",
      message: "Loading monthly sales history and event rules.",
      runId: run.run_id
    });

    const scopes = await fetchForecastScopes(client);
    const eventCalendar = await fetchEventCalendar(client);
    const allRecords = [];
    reportProgress(onProgress, {
      stage: "processing",
      stageLabel: "Processing",
      message: `Generating forecast scopes (0/${scopes.length}).`,
      runId: run.run_id,
      totalScopes: scopes.length,
      processedScopes: 0
    });

    for (const [index, scope] of scopes.entries()) {
      const dealerForecast = await buildBaselineForecast({
        level: "dealer",
        horizon,
        segment: scope.segment,
        modelId: scope.modelId,
        variantId: scope.variantId
      });
      const adjustedForecast = {
        ...dealerForecast,
        levels: buildAdjustedForecastLevels(dealerForecast.levels[0]?.series ?? [], eventCalendar)
      };

      allRecords.push(
        ...flattenForecast({
          runId: run.run_id,
          scope,
          forecast: adjustedForecast
        })
      );

      reportProgress(onProgress, {
        stage: "processing",
        stageLabel: "Processing",
        message: `Generating forecast scopes (${index + 1}/${scopes.length}).`,
        runId: run.run_id,
        totalScopes: scopes.length,
        processedScopes: index + 1
      });
    }

    reportProgress(onProgress, {
      stage: "saving-results",
      stageLabel: "Saving forecast rows",
      message: "Saving generated forecast data.",
      runId: run.run_id,
      totalScopes: scopes.length,
      processedScopes: scopes.length
    });
    const inserted = await insertInBatches(allRecords, client);
    const removed = await removeIrrelevantRows(allRecords, client);
    const calibration = summarizeCalibration(allRecords);
    const completedRun = await ForecastRun.complete(run.run_id, calibration, client);
    await client.query("COMMIT");
    ForecastCacheService.clear();
    reportProgress(onProgress, {
      runId: completedRun.run_id,
      stage: "finished",
      stageLabel: "Finished successfully",
      message: "Forecast regeneration finished successfully.",
      inserted,
      removed,
      calibration,
      totalScopes: scopes.length,
      processedScopes: scopes.length
    });

    console.log(
      `Forecast worker completed run ${completedRun.run_id}: ${inserted} upserted rows, ${removed} removed rows across ${scopes.length} scopes`
    );

    return {
      skipped: false,
      runId: completedRun.run_id,
      inserted,
      removed,
      scopes: scopes.length
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});

    if (run) {
      await ForecastRun.fail(run.run_id, error.message);
    }
    reportProgress(onProgress, {
      runId: run?.run_id ?? null,
      stage: "failed",
      stageLabel: "Failed",
      message: error.message || "Forecast worker failed.",
      error: error.message || "Forecast worker failed."
    });
    console.error("Forecast worker failed", error);
    throw error;
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [workerLockId]).catch(() => {});
    client.release();
  }
}

/**
 * Keeps the worker process alive and schedules the next run for midnight.
 */
function scheduleNextRun() {
  const delay = nextMidnightDelay();
  const runAt = new Date(Date.now() + delay);

  console.log(`Forecast worker scheduled for ${runAt.toLocaleString()}`);

  setTimeout(async () => {
    try {
      await runForecastWorker();
    } catch {
      // Failure is already logged and stored in forecast_runs.
    } finally {
      scheduleNextRun();
    }
  }, delay);
}

if (process.argv[1] === currentFile) {
  const runOnce = process.argv.includes("--once");

  if (runOnce) {
    runForecastWorker()
      .then(async () => {
        await pool.end();
      })
      .catch(async () => {
        await pool.end();
        process.exit(1);
      });
  } else {
    scheduleNextRun();
  }
}
