import { runCustomerServiceAnalysisWorker } from "./customerServiceAnalysisWorker.js";

runCustomerServiceAnalysisWorker()
  .catch((error) => {
    console.error("[customer-service-analysis] Worker crashed", error);
    process.exitCode = 1;
  });
