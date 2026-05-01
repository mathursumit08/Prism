import { Router } from "express";
import { permissions } from "../../auth/accessControl.js";
import { ForecastEventCalendar } from "../../data/models/index.js";
import { requirePermission } from "../../middleware/requirePermission.js";

const router = Router();
const FORECAST_TYPE = "baseline";

router.use(requirePermission(permissions.manageForecast));

router.get("/", async (_request, response) => {
  await respondWithEventAction(response, async () => ({
    ok: true,
    events: normalizeEvents(await ForecastEventCalendar.findAll({ forecastType: FORECAST_TYPE }))
  }));
});

router.post("/", async (request, response) => {
  await respondWithEventAction(
    response,
    async () => ({
      ok: true,
      event: normalizeEvent(await ForecastEventCalendar.insert({
        ...request.body,
        forecast_type: FORECAST_TYPE
      })),
      message: buildRegenerationNote()
    }),
    201
  );
});

router.put("/:eventId", async (request, response) => {
  await respondWithEventAction(response, async () => ({
    ok: true,
    event: normalizeEvent(await ForecastEventCalendar.update(request.params.eventId, {
      ...request.body,
      forecast_type: FORECAST_TYPE
    })),
    message: buildRegenerationNote()
  }));
});

router.delete("/:eventId", async (request, response) => {
  await respondWithEventAction(response, async () => {
    await ForecastEventCalendar.deleteById(request.params.eventId);

    return {
      ok: true,
      deletedEventId: Number(request.params.eventId),
      message: buildRegenerationNote()
    };
  });
});

function buildRegenerationNote() {
  return "Regenerate forecast data for this event calendar change to take effect, or wait for the scheduled worker run.";
}

function normalizeEvent(event) {
  return {
    eventId: event.event_id,
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
