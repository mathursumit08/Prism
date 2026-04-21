import { pool } from "../../db.js";

export const ForecastRun = {
  /**
   * Creates a running forecast-run audit record before generation starts.
   */
  async create({ forecastType = "baseline", horizonMonths }, db = pool) {
    const result = await db.query(
      `
        INSERT INTO forecast_runs (forecast_type, horizon_months)
        VALUES ($1, $2)
        RETURNING *
      `,
      [forecastType, horizonMonths]
    );

    return result.rows[0];
  },

  /**
   * Marks a forecast run as completed and records its completion timestamp.
   */
  async complete(runId, db = pool) {
    const result = await db.query(
      `
        UPDATE forecast_runs
        SET status = 'completed', completed_at = NOW(), error_message = NULL
        WHERE run_id = $1
        RETURNING *
      `,
      [runId]
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
        SET status = 'failed', completed_at = NOW(), error_message = $2
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
  async findLatestCompleted({ forecastType = "baseline" } = {}, db = pool) {
    const result = await db.query(
      `
        SELECT *
        FROM forecast_runs
        WHERE forecast_type = $1
          AND status = 'completed'
        ORDER BY completed_at DESC
        LIMIT 1
      `,
      [forecastType]
    );

    return result.rows[0] ?? null;
  }
};
