import { pool } from "../../db.js";

export const ForecastRun = {
  /**
   * Creates a running forecast-run audit record before generation starts.
   */
  async create({ forecastDomain = "Sales", forecastType = "baseline", horizonMonths }, db = pool) {
    const result = await db.query(
      `
        INSERT INTO forecast_runs (forecast_domain, forecast_type, horizon_months, started_at)
        VALUES ($1, $2, $3, clock_timestamp())
        RETURNING *
      `,
      [forecastDomain, forecastType, horizonMonths]
    );

    return result.rows[0];
  },

  /**
   * Marks a forecast run as completed and records its completion timestamp.
   */
  async complete(runId, calibration = {}, db = pool) {
    const result = await db.query(
      `
        UPDATE forecast_runs
        SET
          status = 'completed',
          completed_at = clock_timestamp(),
          error_message = NULL,
          coverage_80 = $2,
          coverage_95 = $3,
          calibration_sample_count = $4,
          avg_width_80 = $5,
          avg_width_95 = $6,
          horizon_widths = $7::JSONB
        WHERE run_id = $1
        RETURNING *
      `,
      [
        runId,
        calibration.coverage80 ?? null,
        calibration.coverage95 ?? null,
        calibration.sampleCount ?? 0,
        calibration.avgWidth80 ?? null,
        calibration.avgWidth95 ?? null,
        JSON.stringify(calibration.horizonWidths ?? [])
      ]
    );

    return result.rows[0];
  },

  /**
   * Marks a forecast run as failed and stores the error for diagnosis.
   */
  async fail(runId, errorMessage, db = pool) {
    const result = await db.query(
      `
        UPDATE forecast_runs
        SET status = 'failed', completed_at = clock_timestamp(), error_message = $2
        WHERE run_id = $1
        RETURNING *
      `,
      [runId, errorMessage]
    );

    return result.rows[0];
  },

  /**
   * Returns the newest successful run for the requested forecast type.
   */
  async findLatestCompleted({ forecastDomain = "Sales", forecastType = "baseline" } = {}, db = pool) {
    const result = await db.query(
      `
        SELECT *
        FROM forecast_runs
        WHERE forecast_domain = $1
          AND forecast_type = $2
          AND status = 'completed'
        ORDER BY completed_at DESC
        LIMIT 1
      `,
      [forecastDomain, forecastType]
    );

    return result.rows[0] ?? null;
  },

  /**
   * Returns the newest run regardless of status for the requested forecast type.
   */
  async findLatest({ forecastDomain = "Sales", forecastType = "baseline" } = {}, db = pool) {
    const result = await db.query(
      `
        SELECT *
        FROM forecast_runs
        WHERE forecast_domain = $1
          AND forecast_type = $2
        ORDER BY started_at DESC
        LIMIT 1
      `,
      [forecastDomain, forecastType]
    );

    return result.rows[0] ?? null;
  },

  /**
   * Returns the newest failed run for the requested forecast type.
   */
  async findLatestFailed({ forecastDomain = "Sales", forecastType = "baseline" } = {}, db = pool) {
    const result = await db.query(
      `
        SELECT *
        FROM forecast_runs
        WHERE forecast_domain = $1
          AND forecast_type = $2
          AND status = 'failed'
        ORDER BY completed_at DESC NULLS LAST, started_at DESC
        LIMIT 1
      `,
      [forecastDomain, forecastType]
    );

    return result.rows[0] ?? null;
  }
};
