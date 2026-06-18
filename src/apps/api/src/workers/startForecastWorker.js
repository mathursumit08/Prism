import { getForecastWorkerDomainArgument, startForecastWorker } from "./forecastWorker.js";

startForecastWorker({
  requestedDomain: getForecastWorkerDomainArgument()
});
