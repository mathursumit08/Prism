import { pool } from "../db.js";
import { runCustomerServiceAnalysisWorker } from "./customerServiceAnalysisWorker.js";

runCustomerServiceAnalysisWorker({ once: true })
  .catch((error) => {
    console.error("[customer-service-analysis] Worker crashed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
