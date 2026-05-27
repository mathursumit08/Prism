import { Router } from "express";
import { permissions } from "../../auth/accessControl.js";
import { ForecastEventCalendar } from "../../data/models/index.js";

const router = Router();
const domainConfigs = {
  Sales: {
    forecastType: "baseline",
    permission: permissions.manageForecast
  },
  Parts: {
    forecastType: "demand",
    permission: permissions.managePartsForecast
  },
  Service: {
    forecastType: "order_volume",
    permission: permissions.manageServiceForecast
  },
  Warranty: {
    forecastType: "warranty_returns",
    permission: permissions.manageWarrantyForecast
  }
};

router.use(requireAnyForecastEventPermission);

router.get("/", async (request, response) => {
  await respondWithEventAction(response, async () => ({
    ok: true,
    events: normalizeEvents(await ForecastEventCalendar.findAll()).filter((event) =>
      canManageDomain(request.user, event.forecastDomain)
    )
  }));
});

router.post("/", async (request, response) => {
  await respondWithEventAction(
    response,
    async () => {
      const domain = normalizeDomain(request.body?.forecast_domain ?? request.body?.domain);
      ensureCanManageDomain(request.user, domain);
      validateDomainScope(domain, request.body?.scope);
      return {
        ok: true,
        event: normalizeEvent(await ForecastEventCalendar.insert({
          ...request.body,
          forecast_domain: domain,
          forecast_type: domainConfigs[domain].forecastType
        })),
        message: buildRegenerationNote(domain)
      };
    },
    201
  );
});

router.put("/:eventId", async (request, response) => {
  await respondWithEventAction(response, async () => {
    const existing = await ForecastEventCalendar.findById(request.params.eventId);
    const domain = normalizeDomain(request.body?.forecast_domain ?? request.body?.domain ?? existing?.forecast_domain);
    ensureCanManageDomain(request.user, existing?.forecast_domain);
    ensureCanManageDomain(request.user, domain);
    validateDomainScope(domain, request.body?.scope ?? existing?.scope);
    return {
      ok: true,
      event: normalizeEvent(await ForecastEventCalendar.update(request.params.eventId, {
        ...request.body,
        forecast_domain: domain,
        forecast_type: domainConfigs[domain].forecastType
      })),
      message: buildRegenerationNote(domain)
    };
  });
});

router.delete("/:eventId", async (request, response) => {
  await respondWithEventAction(response, async () => {
    const existing = await ForecastEventCalendar.findById(request.params.eventId);
    ensureCanManageDomain(request.user, existing?.forecast_domain);
    await ForecastEventCalendar.deleteById(request.params.eventId);

    return {
      ok: true,
      deletedEventId: Number(request.params.eventId),
      message: buildRegenerationNote(existing.forecast_domain)
    };
  });
});

function buildRegenerationNote(domain = "Sales") {
  return `Regenerate ${domain} forecast data for this event calendar change to take effect, or wait for the scheduled worker run.`;
}

function normalizeDomain(value = "Sales") {
  const text = String(value || "Sales").trim().toLowerCase();
  if (text === "parts") return "Parts";
  if (text === "service") return "Service";
  if (text === "warranty") return "Warranty";
  return "Sales";
}

function canManageDomain(user, domain) {
  const config = domainConfigs[normalizeDomain(domain)];
  return Boolean(config && user?.permissions?.includes(config.permission));
}

function ensureCanManageDomain(user, domain) {
  if (!domain) {
    const error = new Error("Forecast event was not found.");
    error.code = "EVENT_NOT_FOUND";
    throw error;
  }

  if (!canManageDomain(user, domain)) {
    const error = new Error("You do not have permission to manage events for this forecast domain.");
    error.statusCode = 403;
    throw error;
  }
}

function validateDomainScope(domain, scope) {
  if (normalizeDomain(domain) === "Sales" && String(scope || "").trim().toLowerCase() === "service center") {
    const error = new Error("Sales forecast events cannot use Service Center scope.");
    error.code = "INVALID_EVENT";
    throw error;
  }
}

function requireAnyForecastEventPermission(request, response, next) {
  if (!Object.values(domainConfigs).some((config) => request.user?.permissions?.includes(config.permission))) {
    response.status(403).json({
      ok: false,
      error: "You do not have permission to access this resource"
    });
    return;
  }

  next();
}

function normalizeEvent(event) {
  return {
    eventId: event.event_id,
    forecastDomain: event.forecast_domain,
    forecastType: event.forecast_type,
    eventCode: event.event_code,
    eventName: event.event_name,
    eventType: event.event_type,
    scope: event.scope,
    scopeValue: event.scope_value,
    startDate: event.start_date,
    endDate: event.end_date,
    upliftPct: Number(event.uplift_pct),
    isActive: Boolean(event.is_active),
    createdAt: event.created_at,
    updatedAt: event.updated_at
  };
}

function normalizeEvents(events) {
  return events.map(normalizeEvent);
}

async function respondWithEventAction(response, action, successStatusCode = 200) {
  try {
    response.status(successStatusCode).json(await action());
  } catch (error) {
    const statusCode = {
      "23505": 409,
      EVENT_NOT_FOUND: 404,
      INVALID_EVENT: 400
    }[error.code] || error.statusCode || 500;

    response.status(statusCode).json({
      ok: false,
      error: error.code === "23505" ? "An event with this code already exists." : error.message
    });
  }
}

export default router;
