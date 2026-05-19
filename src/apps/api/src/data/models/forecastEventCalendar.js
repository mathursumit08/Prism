import { pool } from "../../db.js";

export const eventTypes = ["Festive", "Regulatory", "Promotional", "Holiday", "Other"];
export const eventScopes = ["National", "Zone", "State"];

function buildValidationError(message) {
  const error = new Error(message);
  error.code = "INVALID_EVENT";
  return error;
}

function isValidDateString(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function normalizeText(value, fieldName, { required = true, maxLength = 120 } = {}) {
  if (value === null || value === undefined) {
    if (!required) {
      return null;
    }

    throw buildValidationError(`${fieldName} is required.`);
  }

  const normalized = String(value).trim();
  if (!normalized) {
    if (!required) {
      return null;
    }

    throw buildValidationError(`${fieldName} is required.`);
  }

  if (normalized.length > maxLength) {
    throw buildValidationError(`${fieldName} must be ${maxLength} characters or fewer.`);
  }

  return normalized;
}

function normalizeOption(value, fieldName, options, { maxLength }) {
  // Store canonical Title Case values while accepting older lowercase payloads
  // from clients or already-seeded data.
  const normalized = normalizeText(value, fieldName, { maxLength });
  const matchingOption = options.find((option) => option.toLowerCase() === normalized.toLowerCase());

  if (!matchingOption) {
    throw buildValidationError(`${fieldName} must be one of: ${options.join(", ")}.`);
  }

  return matchingOption;
}

function normalizeEventPayload(payload, { partial = false } = {}) {
  const normalized = {};
  const hasField = (field) => Object.prototype.hasOwnProperty.call(payload, field);

  if (!partial || hasField("forecast_type")) {
    normalized.forecast_type = normalizeText(payload.forecast_type ?? "baseline", "forecast_type", {
      maxLength: 32
    });
  }

  if (!partial || hasField("event_code")) {
    normalized.event_code = normalizeText(payload.event_code, "event_code", {
      maxLength: 40
    }).toUpperCase().replace(/\s+/g, "_");
  }

  if (!partial || hasField("event_name")) {
    normalized.event_name = normalizeText(payload.event_name, "event_name", {
      maxLength: 120
    });
  }

  if (!partial || hasField("event_type")) {
    normalized.event_type = normalizeOption(payload.event_type ?? "Festive", "event_type", eventTypes, { maxLength: 20 });
  }

  if (!partial || hasField("scope")) {
    normalized.scope = normalizeOption(payload.scope ?? "National", "scope", eventScopes, { maxLength: 10 });
  }

  if (!partial || hasField("scope_value") || hasField("scope")) {
    const scope = normalized.scope ?? normalizeOption(payload.scope, "scope", eventScopes, { maxLength: 10 });
    // National events intentionally clear scope_value; Zone and State events must
    // keep a value so the worker can match them to dealer metadata.
    normalized.scope_value =
      scope === "National"
        ? null
        : normalizeText(payload.scope_value, "scope_value", {
            maxLength: 120
          });
  }

  if (!partial || hasField("start_date")) {
    if (!isValidDateString(payload.start_date)) {
      throw buildValidationError("start_date must be a valid YYYY-MM-DD date.");
    }
    normalized.start_date = payload.start_date;
  }

  if (!partial || hasField("end_date")) {
    if (!isValidDateString(payload.end_date)) {
      throw buildValidationError("end_date must be a valid YYYY-MM-DD date.");
    }
    normalized.end_date = payload.end_date;
  }

  if ((normalized.start_date ?? payload.start_date) && (normalized.end_date ?? payload.end_date)) {
    const startDate = normalized.start_date ?? payload.start_date;
    const endDate = normalized.end_date ?? payload.end_date;
    if (endDate < startDate) {
      throw buildValidationError("end_date must be on or after start_date.");
    }
  }

  if (!partial || hasField("uplift_pct")) {
    const upliftPct = Number(payload.uplift_pct);
    if (!Number.isFinite(upliftPct) || upliftPct < -100 || upliftPct > 200) {
      throw buildValidationError("uplift_pct must be a number from -100 to 200.");
    }
    normalized.uplift_pct = upliftPct;
  }

  if (!partial || hasField("is_active")) {
    normalized.is_active = payload.is_active === undefined ? true : Boolean(payload.is_active);
  }

  return normalized;
}

function formatDbDate(value) {
  if (typeof value === "string") {
    return value.slice(0, 10);
  }

  return value.toISOString().slice(0, 10);
}

export const ForecastEventCalendar = {
  /**
   * Returns active dated event-uplift rules for the requested forecast type.
   */
  async findActive({ forecastType = "baseline" } = {}, db = pool) {
    const result = await db.query(
      `
        SELECT
          event_id,
          forecast_type,
          event_code,
          event_name,
          event_type,
          scope,
          scope_value,
          TO_CHAR(start_date, 'YYYY-MM-DD') AS start_date,
          TO_CHAR(end_date, 'YYYY-MM-DD') AS end_date,
          uplift_pct,
          is_active
        FROM forecast_event_calendar
        WHERE forecast_type = $1
          AND is_active = TRUE
        ORDER BY start_date, end_date, event_name
      `,
      [forecastType]
    );

    return result.rows;
  },

  async findAll({ forecastType = "baseline" } = {}, db = pool) {
    const result = await db.query(
      `
        SELECT
          event_id,
          forecast_type,
          event_code,
          event_name,
          event_type,
          scope,
          scope_value,
          TO_CHAR(start_date, 'YYYY-MM-DD') AS start_date,
          TO_CHAR(end_date, 'YYYY-MM-DD') AS end_date,
          uplift_pct,
          is_active,
          created_at,
          updated_at
        FROM forecast_event_calendar
        WHERE forecast_type = $1
        ORDER BY start_date DESC, event_name
      `,
      [forecastType]
    );

    return result.rows;
  },

  async insert(payload, db = pool) {
    const event = normalizeEventPayload(payload);
    const result = await db.query(
      `
        INSERT INTO forecast_event_calendar (
          forecast_type,
          event_code,
          event_name,
          event_type,
          scope,
          scope_value,
          start_date,
          end_date,
          uplift_pct,
          is_active
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7::DATE, $8::DATE, $9, $10)
        RETURNING
          event_id,
          forecast_type,
          event_code,
          event_name,
          event_type,
          scope,
          scope_value,
          TO_CHAR(start_date, 'YYYY-MM-DD') AS start_date,
          TO_CHAR(end_date, 'YYYY-MM-DD') AS end_date,
          uplift_pct,
          is_active,
          created_at,
          updated_at
      `,
      [
        event.forecast_type,
        event.event_code,
        event.event_name,
        event.event_type,
        event.scope,
        event.scope_value,
        event.start_date,
        event.end_date,
        event.uplift_pct,
        event.is_active
      ]
    );

    return result.rows[0];
  },

  async update(eventId, payload, db = pool) {
    const existingResult = await db.query("SELECT * FROM forecast_event_calendar WHERE event_id = $1", [eventId]);
    const existing = existingResult.rows[0];

    if (!existing) {
      const error = new Error("Forecast event was not found.");
      error.code = "EVENT_NOT_FOUND";
      throw error;
    }

    const merged = {
      forecast_type: existing.forecast_type,
      event_code: existing.event_code,
      event_name: existing.event_name,
      event_type: existing.event_type,
      scope: existing.scope,
      scope_value: existing.scope_value,
      start_date: formatDbDate(existing.start_date),
      end_date: formatDbDate(existing.end_date),
      uplift_pct: existing.uplift_pct,
      is_active: existing.is_active,
      ...payload
    };
    const event = normalizeEventPayload(merged);
    const result = await db.query(
      `
        UPDATE forecast_event_calendar
        SET
          forecast_type = $2,
          event_code = $3,
          event_name = $4,
          event_type = $5,
          scope = $6,
          scope_value = $7,
          start_date = $8::DATE,
          end_date = $9::DATE,
          uplift_pct = $10,
          is_active = $11,
          updated_at = NOW()
        WHERE event_id = $1
        RETURNING
          event_id,
          forecast_type,
          event_code,
          event_name,
          event_type,
          scope,
          scope_value,
          TO_CHAR(start_date, 'YYYY-MM-DD') AS start_date,
          TO_CHAR(end_date, 'YYYY-MM-DD') AS end_date,
          uplift_pct,
          is_active,
          created_at,
          updated_at
      `,
      [
        eventId,
        event.forecast_type,
        event.event_code,
        event.event_name,
        event.event_type,
        event.scope,
        event.scope_value,
        event.start_date,
        event.end_date,
        event.uplift_pct,
        event.is_active
      ]
    );

    return result.rows[0];
  },

  async deleteById(eventId, db = pool) {
    const result = await db.query(
      `
        DELETE FROM forecast_event_calendar
        WHERE event_id = $1
        RETURNING event_id
      `,
      [eventId]
    );

    if (result.rowCount === 0) {
      const error = new Error("Forecast event was not found.");
      error.code = "EVENT_NOT_FOUND";
      throw error;
    }

    return result.rows[0];
  }
};
