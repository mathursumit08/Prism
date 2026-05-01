import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../auth/AuthContext.jsx";

const eventTypes = ["festive", "regulatory", "promotional", "holiday", "other"];
const scopes = ["national", "zone", "state"];
const emptyForm = {
  eventCode: "",
  eventName: "",
  eventType: "festive",
  scope: "national",
  scopeValue: "",
  startDate: "",
  endDate: "",
  upliftPct: 0,
  isActive: true
};

function formatPercent(value) {
  const numericValue = Number(value || 0);
  return `${numericValue > 0 ? "+" : ""}${numericValue.toFixed(1)}%`;
}

function toFormEvent(event) {
  return {
    eventCode: event.eventCode || "",
    eventName: event.eventName || "",
    eventType: event.eventType || "festive",
    scope: event.scope || "national",
    scopeValue: event.scopeValue || "",
    startDate: event.startDate || "",
    endDate: event.endDate || "",
    upliftPct: event.upliftPct ?? 0,
    isActive: Boolean(event.isActive)
  };
}

function toApiEvent(form) {
  return {
    event_code: form.eventCode,
    event_name: form.eventName,
    event_type: form.eventType,
    scope: form.scope,
    scope_value: form.scope === "national" ? null : form.scopeValue,
    start_date: form.startDate,
    end_date: form.endDate,
    uplift_pct: Number(form.upliftPct),
    is_active: form.isActive
  };
}

export default function ForecastEventsPage() {
  const { apiFetch } = useAuth();
  const [eventsState, setEventsState] = useState({
    loading: true,
    error: "",
    events: []
  });
  const [form, setForm] = useState(emptyForm);
  const [editingEventId, setEditingEventId] = useState(null);
  const [actionState, setActionState] = useState({
    loading: false,
    message: "",
    error: ""
  });

  const isEditing = editingEventId !== null;
  const sortedEvents = useMemo(() => eventsState.events, [eventsState.events]);

  useEffect(() => {
    loadEvents();
  }, []);

  async function loadEvents() {
    setEventsState((current) => ({
      ...current,
      loading: true,
      error: ""
    }));

    try {
      const response = await apiFetch("/api/v1/forecasts/admin/events");
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || "Unable to load forecast events.");
      }

      setEventsState({
        loading: false,
        error: "",
        events: payload.events || []
      });
    } catch (error) {
      setEventsState((current) => ({
        ...current,
        loading: false,
        error: error.message || "Unable to load forecast events."
      }));
    }
  }

  function updateField(field, value) {
    setForm((current) => ({
      ...current,
      [field]: value,
      ...(field === "scope" && value === "national" ? { scopeValue: "" } : {})
    }));
  }

  function resetForm() {
    setEditingEventId(null);
    setForm(emptyForm);
  }

  function editEvent(event) {
    setEditingEventId(event.eventId);
    setForm(toFormEvent(event));
    setActionState({
      loading: false,
      message: "",
      error: ""
    });
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setActionState({
      loading: true,
      message: "",
      error: ""
    });

    try {
      const response = await apiFetch(
        isEditing
          ? `/api/v1/forecasts/admin/events/${editingEventId}`
          : "/api/v1/forecasts/admin/events",
        {
          method: isEditing ? "PUT" : "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify(toApiEvent(form))
        }
      );
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || "Unable to save forecast event.");
      }

      setActionState({
        loading: false,
        message: payload.message || "Event saved. Regenerate forecast data for the change to take effect.",
        error: ""
      });
      resetForm();
      await loadEvents();
    } catch (error) {
      setActionState({
        loading: false,
        message: "",
        error: error.message || "Unable to save forecast event."
      });
    }
  }

  async function deleteEvent(event) {
    const confirmed = window.confirm(`Delete ${event.eventName}?`);
    if (!confirmed) {
      return;
    }

    setActionState({
      loading: true,
      message: "",
      error: ""
    });

    try {
      const response = await apiFetch(`/api/v1/forecasts/admin/events/${event.eventId}`, {
        method: "DELETE"
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || "Unable to delete forecast event.");
      }

      setActionState({
        loading: false,
        message: payload.message || "Event deleted. Regenerate forecast data for the change to take effect.",
        error: ""
      });
      if (editingEventId === event.eventId) {
        resetForm();
      }
      await loadEvents();
    } catch (error) {
      setActionState({
        loading: false,
        message: "",
        error: error.message || "Unable to delete forecast event."
      });
    }
  }

  return (
    <>
      <section className="dashboard-header">
        <div>
          <p className="eyebrow">Forecast Events</p>
          <h1>Maintain demand-impacting events.</h1>
          <p className="admin-header-copy">
            Configure dated festive, regulatory, promotional, holiday, and other uplift rules by national, zone, or state scope.
          </p>
        </div>
        <div className="admin-hero-card">
          <span className="status-badge healthy">Calendar</span>
          <strong>{eventsState.loading ? "Loading" : `${sortedEvents.length} events`}</strong>
          <p>Changes affect forecasts after regeneration or the next scheduled worker run.</p>
        </div>
      </section>

      {eventsState.error && <p className="page-notice">{eventsState.error}</p>}
      {actionState.error && <p className="page-notice">{actionState.error}</p>}
      {actionState.message && <p className="page-success">{actionState.message}</p>}

      <section className="forecast-event-layout">
        <form className="forecast-event-form" onSubmit={handleSubmit}>
          <div className="panel-heading compact">
            <div>
              <p className="eyebrow">{isEditing ? "Edit Event" : "New Event"}</p>
              <h2>{isEditing ? "Update calendar event" : "Create calendar event"}</h2>
            </div>
          </div>

          <div className="event-form-grid">
            <label>
              Event code
              <input
                value={form.eventCode}
                onChange={(event) => updateField("eventCode", event.target.value)}
                placeholder="DIWALI_2026"
                required
              />
            </label>
            <label>
              Event name
              <input
                value={form.eventName}
                onChange={(event) => updateField("eventName", event.target.value)}
                placeholder="Diwali"
                required
              />
            </label>
            <label>
              Event type
              <select value={form.eventType} onChange={(event) => updateField("eventType", event.target.value)}>
                {eventTypes.map((eventType) => (
                  <option key={eventType} value={eventType}>
                    {eventType}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Scope
              <select value={form.scope} onChange={(event) => updateField("scope", event.target.value)}>
                {scopes.map((scope) => (
                  <option key={scope} value={scope}>
                    {scope}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Scope value
              <input
                value={form.scopeValue}
                onChange={(event) => updateField("scopeValue", event.target.value)}
                placeholder={form.scope === "zone" ? "North" : form.scope === "state" ? "Maharashtra" : "Not required"}
                disabled={form.scope === "national"}
                required={form.scope !== "national"}
              />
            </label>
            <label>
              Uplift %
              <input
                type="number"
                min="-100"
                max="200"
                step="0.1"
                value={form.upliftPct}
                onChange={(event) => updateField("upliftPct", event.target.value)}
                required
              />
            </label>
            <label>
              Start date
              <input
                type="date"
                value={form.startDate}
                onChange={(event) => updateField("startDate", event.target.value)}
                required
              />
            </label>
            <label>
              End date
              <input
                type="date"
                value={form.endDate}
                onChange={(event) => updateField("endDate", event.target.value)}
                required
              />
            </label>
          </div>

          <label className="event-active-toggle">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(event) => updateField("isActive", event.target.checked)}
            />
            Active event
          </label>

          <div className="event-form-actions">
            <button type="submit" disabled={actionState.loading}>
              {isEditing ? "Update event" : "Create event"}
            </button>
            {isEditing && (
              <button type="button" className="secondary-button" onClick={resetForm} disabled={actionState.loading}>
                Cancel edit
              </button>
            )}
          </div>
        </form>

        <section className="forecast-event-table">
          <div className="panel-heading compact">
            <div>
              <p className="eyebrow">Configured Events</p>
              <h2>Event calendar</h2>
            </div>
            <button type="button" className="secondary-button" onClick={loadEvents} disabled={eventsState.loading}>
              Refresh
            </button>
          </div>

          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Event</th>
                  <th>Type</th>
                  <th>Scope</th>
                  <th>Date range</th>
                  <th>Uplift</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {sortedEvents.length > 0 ? (
                  sortedEvents.map((event) => (
                    <tr key={event.eventId}>
                      <th>
                        <strong>{event.eventName}</strong>
                        <small>{event.eventCode}</small>
                      </th>
                      <td>{event.eventType}</td>
                      <td>
                        {event.scope}
                        {event.scopeValue ? `: ${event.scopeValue}` : ""}
                      </td>
                      <td>
                        {event.startDate} to {event.endDate}
                      </td>
                      <td>{formatPercent(event.upliftPct)}</td>
                      <td>{event.isActive ? "Active" : "Inactive"}</td>
                      <td>
                        <div className="table-actions">
                          <button type="button" className="secondary-button" onClick={() => editEvent(event)}>
                            Edit
                          </button>
                          <button type="button" className="danger-button" onClick={() => deleteEvent(event)}>
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan="7">No forecast events are configured.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </section>
    </>
  );
}
