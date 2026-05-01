import { ForecastBias } from "../data/models/index.js";
import { pool } from "../db.js";

const DEFAULT_WINDOW_MONTHS = 6;

function toNumber(value) {
  return value === null || value === undefined ? null : Number(value);
}

function calculateCorrection(meanError, meanActual) {
  if (!Number.isFinite(meanError) || !Number.isFinite(meanActual) || meanActual <= 0) {
    return 1;
  }

  const denominator = 1 + meanError / meanActual;
  if (!Number.isFinite(denominator) || denominator <= 0) {
    return 1;
  }

  return Number((1 / denominator).toFixed(6));
}

async function fetchBiasRows(level, windowMonths, db) {
  const groupExpression = level === "dealer" ? "d.dealer_id" : "d.region";

  const result = await db.query(
    `
      WITH latest_actual_month AS (
        SELECT MAX(month) AS max_month
        FROM monthly_sales_data
      ),
      actuals AS (
        SELECT
          ${groupExpression} AS group_id,
          m.month,
          SUM(m.units_sold)::NUMERIC AS actual_units
        FROM monthly_sales_data m
        JOIN dealers d ON d.dealer_id = m.dealer_id
        CROSS JOIN latest_actual_month lam
        WHERE lam.max_month IS NOT NULL
          AND m.month >= lam.max_month - (($1::INTEGER - 1) * INTERVAL '1 month')
          AND m.month <= lam.max_month
        GROUP BY ${groupExpression}, m.month
      ),
      forecasts AS (
        SELECT
          fd.group_id,
          fd.forecast_month,
          SUM(fd.forecast_units)::NUMERIC AS forecast_units
        FROM forecast_data fd
        JOIN forecast_runs fr
          ON fr.run_id = fd.run_id
         AND fr.status = 'completed'
        CROSS JOIN latest_actual_month lam
        WHERE fd.forecast_type = 'baseline'
          AND fd.level = $2
          AND fd.segment IS NULL
          AND fd.model_id IS NULL
          AND fd.variant_id IS NULL
          AND lam.max_month IS NOT NULL
          AND fd.forecast_month >= lam.max_month - (($1::INTEGER - 1) * INTERVAL '1 month')
          AND fd.forecast_month <= lam.max_month
        GROUP BY fd.group_id, fd.forecast_month
      )
      SELECT
        $2::VARCHAR AS level,
        a.group_id,
        AVG(f.forecast_units - a.actual_units) AS mean_error,
        AVG(a.actual_units) AS mean_actual
      FROM actuals a
      JOIN forecasts f
        ON f.group_id = a.group_id
       AND f.forecast_month = a.month
      GROUP BY a.group_id
    `,
    [windowMonths, level]
  );

  return result.rows.map((row) => {
    const meanError = toNumber(row.mean_error);
    const meanActual = toNumber(row.mean_actual);

    return {
      level: row.level,
      groupId: row.group_id,
      windowMonths,
      meanError: meanError === null ? null : Number(meanError.toFixed(4)),
      correction: calculateCorrection(meanError, meanActual)
    };
  });
}

export const ForecastBiasService = {
  async computeAndStore({ windowMonths = DEFAULT_WINDOW_MONTHS } = {}, db = pool) {
    const safeWindow = Number.isInteger(Number(windowMonths)) ? Math.max(1, Number(windowMonths)) : DEFAULT_WINDOW_MONTHS;
    const records = [
      ...(await fetchBiasRows("dealer", safeWindow, db)),
      ...(await fetchBiasRows("zone", safeWindow, db))
    ];

    const saved = await ForecastBias.upsertMany(records, db);

    return {
      windowMonths: safeWindow,
      recordsComputed: records.length,
      recordsSaved: saved
    };
  },

  async findCorrectionMap(db = pool) {
    return ForecastBias.findCorrectionMap(db);
  }
};
