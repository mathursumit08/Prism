import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import { pool } from "../db.js";
import { buildBaselineForecast } from "../forecasting/baselineForecast.js";
import { ForecastData, ForecastEventCalendar, ForecastRun } from "../data/models/index.js";

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
  modelId,
  variantId,
  forecastMonth
}) {
  return [
    forecastType,
    level,
    groupId,
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
  const upliftedUnitsSold = Math.max(0, Math.round(point.unitsSold * (1 + totalUpliftPct / 100)));

  return {
    ...point,
    unitsSold: upliftedUnitsSold
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
          unitsSold: 0
        }))
      });
    }

    const aggregate = grouped.get(groupId);

    dealer.history.forEach((point, index) => {
      aggregate.history[index].unitsSold += point.unitsSold;
    });

    dealer.forecast.forEach((point, index) => {
      aggregate.forecast[index].unitsSold += point.unitsSold;
    });
  }

  return [...grouped.values()];
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
  const result = await db.query(`
    SELECT DISTINCT model_id, NULL::VARCHAR(16) AS variant_id
    FROM monthly_sales_data
    UNION
    SELECT DISTINCT model_id, variant_id
    FROM monthly_sales_data
    ORDER BY model_id, variant_id NULLS FIRST
  `);

  return [
    {
      modelId: null,
      variantId: null
    },
    ...result.rows.map((row) => ({
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
        records.push({
          runId,
          forecastType: FORECAST_TYPE,
          level: series.level,
          groupId: series.groupId,
          groupLabel: series.groupLabel,
          modelId: scope.modelId,
          variantId: scope.variantId,
          forecastMonth: point.month,
          forecastUnits: point.unitsSold,
          modelMethod: series.method,
          validationMae: series.validation.mae,
          validationRmse: series.validation.rmse,
          validationMape: series.validation.mape
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
export async function runForecastWorker({ horizon = parseHorizon(process.env.FORECAST_HORIZON_MONTHS) } = {}) {
  const client = await pool.connect();
  let run = null;

  console.log(`Forecast worker started with horizon ${horizon} month(s)`);

  try {
    const lockResult = await client.query("SELECT pg_try_advisory_lock($1) AS locked", [workerLockId]);
    if (!lockResult.rows[0]?.locked) {
      console.log("Forecast worker skipped because another run is already active");
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

    const scopes = await fetchForecastScopes(client);
    const eventCalendar = await fetchEventCalendar(client);
    const allRecords = [];

    for (const scope of scopes) {
      const dealerForecast = await buildBaselineForecast({
        level: "dealer",
        horizon,
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
    }

    const inserted = await insertInBatches(allRecords, client);
    const removed = await removeIrrelevantRows(allRecords, client);
    const completedRun = await ForecastRun.complete(run.run_id, client);
    await client.query("COMMIT");

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
