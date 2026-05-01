import { pool } from "../../db.js";

export const ForecastBias = {
  async upsertMany(records, db = pool) {
    if (records.length === 0) {
      return 0;
    }

    const columns = ["level", "group_id", "window_months", "mean_error", "correction"];
    const values = [];
    const placeholders = records.map((record, rowIndex) => {
      const offset = rowIndex * columns.length;
      values.push(
        record.level,
        record.groupId,
        record.windowMonths,
        record.meanError,
        record.correction
      );

      return `(${columns.map((_column, columnIndex) => `$${offset + columnIndex + 1}`).join(", ")})`;
    });

    await db.query(
      `
        INSERT INTO forecast_bias (${columns.join(", ")})
        VALUES ${placeholders.join(", ")}
        ON CONFLICT (level, group_id)
        DO UPDATE SET
          window_months = EXCLUDED.window_months,
          mean_error = EXCLUDED.mean_error,
          correction = EXCLUDED.correction,
          computed_at = NOW()
        WHERE NOT (
          forecast_bias.correction = 1.0
          AND forecast_bias.mean_error IS NULL
        )
      `,
      values
    );

    return records.length;
  },

  async findAll(db = pool) {
    const result = await db.query(
      `
        SELECT level, group_id, window_months, mean_error, correction, computed_at
        FROM forecast_bias
      `
    );

    return result.rows;
  },

  async findCorrectionMap(db = pool) {
    const rows = await this.findAll(db);
    return new Map(rows.map((row) => [
      `${row.level}:${row.group_id}`,
      Number(row.correction ?? 1)
    ]));
  }
};
