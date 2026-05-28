import { Router } from "express";
import { authenticate } from "../../middleware/authenticate.js";
import { requirePermission } from "../../middleware/requirePermission.js";
import { permissions } from "../../auth/accessControl.js";
import { parseForecastQuery } from "./forecastQuery.js";
import { ForecastAdminService } from "../../services/forecastAdminService.js";
import forecastEventRoutes from "./forecastEventRoutes.js";
import {
  forecastEndpointConfigs,
  getActualsPayload,
  getBaselineForecastPayload,
  getSalesKpiPayload,
  getVersionedForecastPayload
} from "../../services/forecastQueryService.js";
import { getForecastMetricsPayload } from "../../services/forecastMetricsService.js";
import {
  getCalibrationHistoryPayload,
  getForecastAccuracyLeaderboardPayload,
  getForecastErrorHistogramPayload,
  getForecastMetricTrendPayload,
  getForecastObservationPayload
} from "../../services/forecastAnalyticsService.js";
import { ForecastDashboardCardService } from "../../services/forecastDashboardCardService.js";
import {
  getDomainActualsPayload,
  getDomainDiagnosticsPayload,
  getDomainForecastPayload,
  getDomainKpiPayload,
  getDomainReferencePayload
} from "../../services/domainForecastQueryService.js";

const router = Router();

router.use(authenticate);

router.use("/admin/events", forecastEventRoutes);

router.get("/baseline", requirePermission(permissions.viewForecast), async (request, response) => {
  await respondWithServiceCall(response, () => getBaselineForecastPayload(request.user, request.query));
});

router.get("/actuals", requirePermission(permissions.viewForecast), async (request, response) => {
  await respondWithServiceCall(response, () => getActualsPayload(request.user, request.query));
});

router.get("/metrics", requirePermission(permissions.viewForecast), async (request, response) => {
  await respondWithServiceCall(response, () => getForecastMetricsPayload(request.user, request.query));
});

router.get("/metrics/trend", requirePermission(permissions.viewForecast), async (request, response) => {
  await respondWithServiceCall(response, () => getForecastMetricTrendPayload(request.user, request.query));
});

router.get("/metrics/observations", requirePermission(permissions.viewForecast), async (request, response) => {
  await respondWithServiceCall(response, () => getForecastObservationPayload(request.user, request.query));
});

router.get("/metrics/histogram", requirePermission(permissions.viewForecast), async (request, response) => {
  await respondWithServiceCall(response, () => getForecastErrorHistogramPayload(request.user, request.query));
});

router.get("/metrics/leaderboard", requirePermission(permissions.viewForecast), async (request, response) => {
  await respondWithServiceCall(response, () => getForecastAccuracyLeaderboardPayload(request.user, request.query));
});

router.get("/kpis", requirePermission(permissions.viewForecast), async (request, response) => {
  await respondWithServiceCall(response, () => getSalesKpiPayload(request.user, request.query));
});

router.get("/dashboard-cards", requireDashboardCardReadPermission, async (request, response) => {
  // Read access is available to forecast users because the shell and dashboard
  // both need these settings to decide what should be visible.
  await respondWithServiceCall(response, () => ForecastDashboardCardService.findAll({ domain: request.query.domain }));
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

router.get("/parts", requirePermission(permissions.viewPartsForecast), async (request, response) => {
  await respondWithServiceCall(response, () => getDomainForecastPayload("parts", request.query, request.user));
});

router.get("/parts/references", requirePermission(permissions.viewPartsForecast), async (request, response) => {
  await respondWithServiceCall(response, () => getDomainReferencePayload("parts", request.user));
});

router.get("/parts/actuals", requirePermission(permissions.viewPartsForecast), async (request, response) => {
  await respondWithServiceCall(response, () => getDomainActualsPayload("parts", request.query, request.user));
});

router.get("/parts/diagnostics", requirePermission(permissions.viewPartsForecast), async (request, response) => {
  await respondWithServiceCall(response, () => getDomainDiagnosticsPayload("parts", request.query, request.user));
});

router.get("/parts/kpis", requirePermission(permissions.viewPartsForecast), async (request, response) => {
  await respondWithServiceCall(response, () => getDomainKpiPayload("parts", request.query, request.user));
});

router.get("/service", requirePermission(permissions.viewServiceForecast), async (request, response) => {
  await respondWithServiceCall(response, () => getDomainForecastPayload("service", request.query, request.user));
});

router.get("/service/references", requirePermission(permissions.viewServiceForecast), async (request, response) => {
  await respondWithServiceCall(response, () => getDomainReferencePayload("service", request.user));
});

router.get("/service/actuals", requirePermission(permissions.viewServiceForecast), async (request, response) => {
  await respondWithServiceCall(response, () => getDomainActualsPayload("service", request.query, request.user));
});

router.get("/service/diagnostics", requirePermission(permissions.viewServiceForecast), async (request, response) => {
  await respondWithServiceCall(response, () => getDomainDiagnosticsPayload("service", request.query, request.user));
});

router.get("/service/kpis", requirePermission(permissions.viewServiceForecast), async (request, response) => {
  await respondWithServiceCall(response, () => getDomainKpiPayload("service", request.query, request.user));
});

router.get("/warranty", requirePermission(permissions.viewWarrantyForecast), async (request, response) => {
  await respondWithServiceCall(response, () => getDomainForecastPayload("warranty", request.query, request.user));
});

router.get("/warranty/references", requirePermission(permissions.viewWarrantyForecast), async (request, response) => {
  await respondWithServiceCall(response, () => getDomainReferencePayload("warranty", request.user));
});

router.get("/warranty/actuals", requirePermission(permissions.viewWarrantyForecast), async (request, response) => {
  await respondWithServiceCall(response, () => getDomainActualsPayload("warranty", request.query, request.user));
});

router.get("/warranty/diagnostics", requirePermission(permissions.viewWarrantyForecast), async (request, response) => {
  await respondWithServiceCall(response, () => getDomainDiagnosticsPayload("warranty", request.query, request.user));
});

router.get("/warranty/kpis", requirePermission(permissions.viewWarrantyForecast), async (request, response) => {
  await respondWithServiceCall(response, () => getDomainKpiPayload("warranty", request.query, request.user));
});

router.get("/admin/status", requirePermission(permissions.manageForecast), async (_request, response) => {
  await respondWithServiceCall(response, async () => ({
    ok: true,
    ...(await ForecastAdminService.getStatus())
  }));
});

router.get("/admin/:domain/status", requireDomainManagePermission, async (request, response) => {
  await respondWithServiceCall(
    response,
    async () => ({
      ok: true,
      ...(await ForecastAdminService.getDomainStatus(request.params.domain))
    }),
    {
      INVALID_DOMAIN: 404
    }
  );
});

router.get("/admin/calibration-history", requirePermission(permissions.manageForecast), async (request, response) => {
  await respondWithServiceCall(response, () => getCalibrationHistoryPayload(request.user, request.query));
});

router.put("/admin/dashboard-cards", requireAdmin, async (request, response) => {
  await respondWithServiceCall(response, () => ForecastDashboardCardService.updateCards(request.body?.cards));
});

router.post("/admin/clear", requirePermission(permissions.manageForecast), async (_request, response) => {
  await respondWithServiceCall(response, async () => {
    const deletedRows = await ForecastAdminService.clearFutureForecastData();
    const status = await ForecastAdminService.getStatus();

    return {
      ok: true,
      deletedRows,
      ...status
    };
  });
});

router.post("/admin/:domain/clear", requireDomainManagePermission, async (request, response) => {
  await respondWithServiceCall(
    response,
    async () => {
      const deletedRows = await ForecastAdminService.clearFutureForecastDataForDomain(request.params.domain);
      const status = await ForecastAdminService.getDomainStatus(request.params.domain);

      return {
        ok: true,
        deletedRows,
        ...status
      };
    },
    {
      INVALID_DOMAIN: 404,
      RUN_IN_PROGRESS: 409
    }
  );
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

router.post("/admin/:domain/regenerate", requireDomainManagePermission, async (request, response) => {
  await respondWithServiceCall(
    response,
    async () => ({
      ok: true,
      generation: await ForecastAdminService.regenerateForecastForDomain({
        domain: request.params.domain,
        horizon: request.body?.horizon
      })
    }),
    {
      INVALID_DOMAIN: 404,
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

function requireAdmin(request, response, next) {
  if (request.user?.role !== "Admin") {
    response.status(403).json({
      ok: false,
      error: "Only Admin users can manage dashboard cards"
    });
    return;
  }

  next();
}

function requireDashboardCardReadPermission(request, response, next) {
  const domain = ForecastDashboardCardService.normalizeDomain(request.query.domain);
  const permissionByDomain = {
    Sales: permissions.viewForecast,
    Parts: permissions.viewPartsForecast,
    Service: permissions.viewServiceForecast,
    Warranty: permissions.viewWarrantyForecast
  };

  if (request.query.domain && !domain) {
    response.status(400).json({
      ok: false,
      error: "Unsupported dashboard card domain"
    });
    return;
  }

  if (domain) {
    if (!request.user?.permissions?.includes(permissionByDomain[domain])) {
      response.status(403).json({
        ok: false,
        error: "You do not have permission to access this resource"
      });
      return;
    }
    next();
    return;
  }

  if (
    !request.user?.permissions?.some((permission) =>
      [permissions.viewForecast, permissions.viewPartsForecast, permissions.viewServiceForecast].includes(permission)
      || permission === permissions.viewWarrantyForecast
    )
  ) {
    response.status(403).json({
      ok: false,
      error: "You do not have permission to access this resource"
    });
    return;
  }

  next();
}

function requireDomainManagePermission(request, response, next) {
  const permissionByDomain = {
    sales: permissions.manageForecast,
    parts: permissions.managePartsForecast,
    service: permissions.manageServiceForecast,
    warranty: permissions.manageWarrantyForecast
  };
  const requiredPermission = permissionByDomain[request.params.domain];

  if (!requiredPermission) {
    response.status(404).json({
      ok: false,
      error: "Unsupported forecast domain"
    });
    return;
  }

  if (!request.user?.permissions?.includes(requiredPermission)) {
    response.status(403).json({
      ok: false,
      error: "You do not have permission to access this resource"
    });
    return;
  }

  next();
}

export default router;
