import { pool } from "../../db.js";

export const ForecastEventCalendar = {
  /**
   * Returns active recurring event-uplift rules for the requested forecast type.
   */
  async findActive({ forecastType = "baseline" } = {}, db = pool) {
    const result = await db.query(
      `
        SELECT
          event_id,
          forecast_type,
          event_code,
          event_name,
          start_month,
          end_month,
          uplift_pct,
          is_active
        FROM forecast_event_calendar
        WHERE forecast_type = $1
          AND is_active = TRUE
        ORDER BY start_month, end_month, event_name
      `,
      [forecastType]
    );

    return result.rows;
  }
};
