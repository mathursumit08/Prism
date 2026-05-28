import { pool } from "../../db.js";

export const DomainForecastRollup = {
  async refresh({ forecastDomain, runId, forecastType }, db = pool) {
    await db.query(
      "CALL refresh_domain_forecast_rollups($1, $2, $3)",
      [forecastDomain, runId, forecastType]
    );
  }
};
