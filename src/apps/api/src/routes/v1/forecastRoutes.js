import { Router } from "express";
import { authenticate } from "../../middleware/authenticate.js";
import { requirePermission } from "../../middleware/requirePermission.js";
import { permissions } from "../../auth/accessControl.js";
import { parseForecastQuery } from "./forecastQuery.js";
import { ForecastAdminService } from "../../services/forecastAdminService.js";
import {
  forecastEndpointConfigs,
  getActualsPayload,
  getBaselineForecastPayload,
  getVersionedForecastPayload
} from "../../services/forecastQueryService.js";
import { getForecastMetricsPayload } from "../../services/forecastMetricsService.js";

const router = Router();

router.use(authenticate);

router.get("/baseline", requirePermission(permissions.viewForecast), async (request, response) => {
  await respondWithServiceCall(response, () => getBaselineForecastPayload(request.user, request.query));
});

router.get("/actuals", requirePermission(permissions.viewForecast), async (request, response) => {
  await respondWithServiceCall(response, () => getActualsPayload(request.user, request.query));
});

router.get("/metrics", requirePermission(permissions.viewForecast), async (request, response) => {
  await respondWithServiceCall(response, () => getForecastMetricsPayload(request.user, request.query));
});

router.get("/dealer-targets", requirePermission(permissions.viewForecast), async (request, response) => {
  await handleVersionedForecastRequest(request, response, forecastEndpointConfigs["dealer-targets"]);
});

router.get("/regional", requirePermission(permissions.viewForecast), async (request, response) => {
  await handleVersionedForecastRequest(request, response, forecastEndpointConfigs.regional);
});

router.get("/national", requirePermission(permissions.viewForecast), async (request, response) => {
  await handleVersionedForecastRequest(request, response, forecastEndpointConfigs.national);
});

router.get("/blended", requirePermission(permissions.viewForecast), async (request, response) => {
  await handleVersionedForecastRequest(request, response, forecastEndpointConfigs.blended);
});

router.get("/admin/status", requirePermission(permissions.manageForecast), async (_request, response) => {
  await respondWithServiceCall(response, async () => ({
    ok: true,
    ...(await ForecastAdminService.getStatus())
  }));
});

router.post("/admin/clear", requirePermission(permissions.manageForecast), async (_request, response) => {
  await respondWithServiceCall(response, async () => {
    const deletedRows = await ForecastAdminService.clearForecastData();
    const status = await ForecastAdminService.getStatus();

    return {
      ok: true,
      deletedRows,
      ...status
    };
  });
});

router.post("/admin/regenerate", requirePermission(permissions.manageForecast), async (request, response) => {
  await respondWithServiceCall(
    response,
    async () => ({
      ok: true,
      generation: await ForecastAdminService.regenerateForecast({
        horizon: request.body?.horizon
      })
    }),
    {
      INVALID_HORIZON: 400,
      RUN_IN_PROGRESS: 409
    },
    202
  );
});

async function handleVersionedForecastRequest(request, response, endpointConfig) {
  const parsed = parseForecastQuery(request.query);
  if (!parsed.isValid) {
    response.status(400).json({
      ok: false,
      error: "Invalid forecast query parameters",
      details: parsed.errors
    });
    return;
  }

  await respondWithServiceCall(response, () =>
    getVersionedForecastPayload(request.user, endpointConfig, parsed.filters)
  );
}

async function respondWithServiceCall(response, action, codeMap = {}, successStatusCode = 200) {
  try {
    const payload = await action();
    response.status(successStatusCode).json(payload);
  } catch (error) {
    const statusCode = error.statusCode || codeMap[error.code] || 500;
    response.status(statusCode).json({
      ok: false,
      error: error.message
    });
  }
}

export default router;
