import { pool } from "../db.js";
import { getForecastWorkerDomainArgument, runForecastWorkerOnce } from "./forecastWorker.js";

runForecastWorkerOnce({
  requestedDomain: getForecastWorkerDomainArgument()
})
  .then(async () => {
    await pool.end();
  })
  .catch(async () => {
    await pool.end();
    process.exit(1);
  });
