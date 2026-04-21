import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import { pool } from "../db.js";
import { buildBaselineForecast } from "../forecasting/baselineForecast.js";
import { ForecastData, ForecastRun } from "../data/models/index.js";

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
    const allRecords = [];

    for (const scope of scopes) {
      const forecast = await buildBaselineForecast({
        level: "all",
        horizon,
        modelId: scope.modelId,
        variantId: scope.variantId
      });

      allRecords.push(
        ...flattenForecast({
          runId: run.run_id,
          scope,
          forecast
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
