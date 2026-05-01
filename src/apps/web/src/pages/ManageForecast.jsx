import { useEffect, useState } from "react";
import { useAuth } from "../auth/AuthContext.jsx";
const forecastHorizons = [6, 12, 24];

function formatUnits(value) {
  return new Intl.NumberFormat("en-IN").format(Math.round(value || 0));
}

function formatPercent(value) {
  if (value === null || value === undefined) {
    return "Not available";
  }

  return `${Number(value).toFixed(1)}%`;
}

function formatDateTime(value) {
  if (!value) {
    return "Not available";
  }

  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function formatDuration(start, end) {
  if (!start || !end) {
    return "Not available";
  }

  const startNs = parseTimestampToNanoseconds(start);
  const endNs = parseTimestampToNanoseconds(end);

  if (startNs === null || endNs === null || endNs < startNs) {
    return "Not available";
  }

  const totalNanoseconds = endNs - startNs;
  const minuteNs = 60_000_000_000n;
  const secondNs = 1_000_000_000n;
  const millisecondNs = 1_000_000n;
  const minutes = totalNanoseconds / minuteNs;
  const seconds = (totalNanoseconds % minuteNs) / secondNs;
  const milliseconds = (totalNanoseconds % secondNs) / millisecondNs;
  const remainingNanoseconds = totalNanoseconds % millisecondNs;

  const parts = [];

  if (minutes > 0n) {
    parts.push(`${minutes}m`);
  }

  if (seconds > 0n) {
    parts.push(`${seconds}s`);
  }

  if (milliseconds > 0n) {
    parts.push(`${milliseconds}ms`);
  }

  if (parts.length === 0) {
    parts.push(`${remainingNanoseconds}ns`);
  }

  return parts.join(" ");
}

function parseTimestampToNanoseconds(value) {
  if (!value) {
    return null;
  }

  const match = value.match(/^(.*?)(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/);
  if (!match) {
    return null;
  }

  const [, base, fraction = "", zone] = match;
  const baseMilliseconds = Date.parse(`${base}${zone}`);
  if (!Number.isFinite(baseMilliseconds)) {
    return null;
  }

  const fractionalNanoseconds = BigInt((fraction.padEnd(9, "0")).slice(0, 9) || "0");
  return BigInt(baseMilliseconds) * 1_000_000n + fractionalNanoseconds;
}

export default function ManageForecastPage() {
  const { apiFetch } = useAuth();
  const [selectedHorizon, setSelectedHorizon] = useState(6);
  const [adminState, setAdminState] = useState({
    loading: true,
    error: "",
    data: null
  });
  const [actionState, setActionState] = useState({
    loading: false,
    message: "",
    error: ""
  });

  useEffect(() => {
    let isMounted = true;
    let intervalId = null;

    async function loadStatus() {
      try {
        const response = await apiFetch("/api/v1/forecasts/admin/status");
        const payload = await response.json();

        if (!response.ok) {
          throw new Error(payload.error || "Unable to load forecast admin status.");
        }

        if (!isMounted) {
          return;
        }

        setAdminState({
          loading: false,
          error: "",
          data: payload
        });
      } catch (error) {
        if (!isMounted) {
          return;
        }

        setAdminState((current) => ({
          loading: false,
          error: error.message || "Unable to load forecast admin status.",
          data: current.data
        }));
      }
    }

    loadStatus();
    intervalId = window.setInterval(loadStatus, adminState.data?.generation?.running ? 2000 : 15000);

    return () => {
      isMounted = false;
      window.clearInterval(intervalId);
    };
  }, [adminState.data?.generation?.running, apiFetch]);

  async function refreshStatus() {
    setAdminState((current) => ({
      ...current,
      loading: current.data ? current.loading : true,
      error: ""
    }));

    try {
      const response = await apiFetch("/api/v1/forecasts/admin/status");
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || "Unable to load forecast admin status.");
      }

      setAdminState({
        loading: false,
        error: "",
        data: payload
      });
    } catch (error) {
      setAdminState((current) => ({
        ...current,
        loading: false,
        error: error.message || "Unable to load forecast admin status."
      }));
    }
  }

  async function handleClear() {
    const confirmed = window.confirm(
      "Clear future forecast rows? Forecast rows for months with actuals will be preserved for metrics and bias correction."
    );
    if (!confirmed) {
      return;
    }

    setActionState({
      loading: true,
      message: "",
      error: ""
    });

    try {
      const response = await apiFetch("/api/v1/forecasts/admin/clear", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        }
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || "Unable to clear forecast data.");
      }

      setAdminState({
        loading: false,
        error: "",
        data: payload
      });
      setActionState({
        loading: false,
        message: `${formatUnits(payload.deletedRows)} future forecast rows cleared successfully.`,
        error: ""
      });
    } catch (error) {
      setActionState({
        loading: false,
        message: "",
        error: error.message || "Unable to clear forecast data."
      });
    }
  }

  async function handleRegenerate() {
    setActionState({
      loading: true,
      message: "",
      error: ""
    });

    try {
      const response = await apiFetch("/api/v1/forecasts/admin/regenerate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          horizon: selectedHorizon
        })
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || "Unable to start forecast regeneration.");
      }

      setActionState({
        loading: false,
        message: `${selectedHorizon}-month forecast regeneration started.`,
        error: ""
      });
      await refreshStatus();
    } catch (error) {
      setActionState({
        loading: false,
        message: "",
        error: error.message || "Unable to start forecast regeneration."
      });
    }
  }

  const data = adminState.data;
  const generation = data?.generation;
  const lastSuccessfulRun = data?.lastSuccessfulRun;
  const lastFailedRun = data?.lastFailedRun;
  const latestRun = data?.latestRun;
  const activeEvents = data?.activeEvents || [];
  const calibration = data?.calibration;
  const progressStages = [
    { key: "initializing", label: "Initializing" },
    { key: "loading-source-data", label: "Loading source data" },
    { key: "processing", label: "Processing" },
    { key: "saving-results", label: "Saving forecast rows" },
    { key: "finished", label: "Finished successfully" }
  ];
  const activeStageIndex = progressStages.findIndex((stage) => stage.key === generation?.stage);
  const latestRunDuration = latestRun ? formatDuration(latestRun.startedAt, latestRun.completedAt) : "Not available";

  return (
    <>
      <section className="dashboard-header">
        <div>
          <p className="eyebrow">Forecast Administration</p>
          <h1>Manage the forecast pipeline without leaving Prism.</h1>
          <p className="admin-header-copy">
            Review run health, clear future output, and launch a new forecast regeneration with live progress.
          </p>
        </div>
        <div className="admin-hero-card">
          <span className={`status-badge ${generation?.running ? "running" : generation?.stage === "failed" ? "failed" : "healthy"}`}>
            {generation?.running ? "Run in progress" : generation?.stage === "failed" ? "Attention needed" : "Healthy"}
          </span>
          <strong>{lastSuccessfulRun ? formatDateTime(lastSuccessfulRun.completedAt) : "No successful run yet"}</strong>
          <p>Last successful forecast refresh</p>
        </div>
      </section>

      {adminState.error && <p className="page-notice">{adminState.error}</p>}
      {actionState.error && <p className="page-notice">{actionState.error}</p>}
      {actionState.message && <p className="page-success">{actionState.message}</p>}

      <section className="admin-actions-panel">
        <div className="panel-heading compact">
          <div>
            <p className="eyebrow">Run controls</p>
              <h2>Clear future rows or regenerate forecast data</h2>
          </div>
          <span className={`source-pill ${generation?.running ? "" : "live"}`}>
            {generation?.stageLabel || "Idle"}
          </span>
        </div>

        <div className="admin-actions-row">
          <label>
            Horizon
            <select
              value={selectedHorizon}
              onChange={(event) => setSelectedHorizon(Number(event.target.value))}
              disabled={generation?.running || actionState.loading}
            >
              {forecastHorizons.map((months) => (
                <option key={months} value={months}>
                  {months} months
                </option>
              ))}
            </select>
          </label>

          <button type="button" onClick={handleRegenerate} disabled={generation?.running || actionState.loading}>
            Regenerate forecast
          </button>

          <button type="button" className="secondary-button" onClick={refreshStatus} disabled={actionState.loading}>
            Refresh status
          </button>

          <button type="button" className="danger-button" onClick={handleClear} disabled={generation?.running || actionState.loading}>
            Clear future forecast rows
          </button>
        </div>
      </section>

      <section className="summary-grid admin-summary-grid" aria-label="Forecast admin summary">
        <article className="metric">
          <span>Last successful run</span>
          <strong>{lastSuccessfulRun ? formatDateTime(lastSuccessfulRun.completedAt) : "Not available"}</strong>
          <p>
            {lastSuccessfulRun
              ? `${lastSuccessfulRun.horizonMonths}-month horizon`
              : "No completed forecast run has been recorded yet."}
          </p>
        </article>
        <article className="metric">
          <span>Stored forecast rows</span>
          <strong>{data ? formatUnits(data.storedForecastRows) : "Loading"}</strong>
          <p>Current rows available to forecast screens, metrics, and bias correction.</p>
        </article>
        <article className="metric">
          <span>Latest run duration</span>
          <strong>{latestRunDuration}</strong>
          <p>{latestRun ? `Latest run status: ${latestRun.status}` : "Run duration will appear after the first run."}</p>
        </article>
        <article className="metric">
          <span>Interval calibration</span>
          <strong>{calibration ? formatPercent(calibration.coverage80) : "No data"}</strong>
          <p>80% empirical coverage on rolling hold-out.</p>
        </article>
      </section>

      <section className="analytics-grid" aria-label="Forecast admin details">
        <article className="analytics-panel">
          <div className="panel-heading compact">
            <div>
              <p className="eyebrow">Progress</p>
              <h2>Current regeneration status</h2>
            </div>
          </div>

          <div className="status-strip">
            <strong>{generation?.stageLabel || "Idle"}</strong>
            <p>{generation?.message || "No forecast regeneration is active."}</p>
            {generation?.totalScopes > 0 && (
              <p>
                {generation.processedScopes}/{generation.totalScopes} scopes processed
              </p>
            )}
            {generation?.error && <p className="status-error">{generation.error}</p>}
          </div>

          <div className="progress-steps">
            {progressStages.map((stage, index) => {
              const isDone = activeStageIndex >= index && generation?.stage !== "failed";
              const isActive = generation?.stage === stage.key;
              return (
                <div
                  key={stage.key}
                  className={`progress-step ${isDone ? "done" : ""} ${isActive ? "active" : ""}`}
                >
                  <span>{index + 1}</span>
                  <strong>{stage.label}</strong>
                </div>
              );
            })}
            <div className={`progress-step ${generation?.stage === "failed" ? "failed active" : ""}`}>
              <span>!</span>
              <strong>Failed</strong>
            </div>
          </div>
        </article>

        <article className="analytics-panel">
          <div className="panel-heading compact">
            <div>
              <p className="eyebrow">Health</p>
              <h2>Run health summary</h2>
            </div>
          </div>

          <div className="admin-detail-list">
            <div>
              <span>Last refresh summary</span>
              <strong>
                {lastSuccessfulRun
                  ? `${lastSuccessfulRun.horizonMonths}-month forecast completed on ${formatDateTime(lastSuccessfulRun.completedAt)}`
                  : "No successful forecast run yet"}
              </strong>
            </div>
            <div>
              <span>Latest run status</span>
              <strong>{latestRun?.status || "Not available"}</strong>
            </div>
            <div>
              <span>Last failed run</span>
              <strong>{lastFailedRun ? formatDateTime(lastFailedRun.completedAt) : "No recent failure"}</strong>
              {lastFailedRun?.errorMessage && <p>{lastFailedRun.errorMessage}</p>}
            </div>
          </div>
        </article>
      </section>

      <section className="analytics-grid" aria-label="Forecast assumptions">
        <article className="analytics-panel">
          <div className="panel-heading compact">
            <div>
              <p className="eyebrow">Calibration</p>
              <h2>Prediction interval coverage</h2>
            </div>
          </div>
          {calibration ? (
            <>
              <div className="calibration-grid">
                <div className={calibration.target80WithinTolerance ? "calibration-card healthy" : "calibration-card warning"}>
                  <span>80% target</span>
                  <strong>{formatPercent(calibration.coverage80)}</strong>
                  <p>{calibration.target80WithinTolerance ? "Within +/-2% tolerance" : "Outside +/-2% tolerance"}</p>
                </div>
                <div className={calibration.target95WithinTolerance ? "calibration-card healthy" : "calibration-card warning"}>
                  <span>95% target</span>
                  <strong>{formatPercent(calibration.coverage95)}</strong>
                  <p>{calibration.target95WithinTolerance ? "Within +/-2% tolerance" : "Outside +/-2% tolerance"}</p>
                </div>
              </div>
              <div className="admin-detail-list">
                <div>
                  <span>Calibration sample count</span>
                  <strong>{formatUnits(calibration.sampleCount)}</strong>
                </div>
                <div>
                  <span>Average interval width</span>
                  <strong>
                    80%: {formatUnits(calibration.avgWidth80)} | 95%: {formatUnits(calibration.avgWidth95)}
                  </strong>
                </div>
                <div>
                  <span>Horizon width trend</span>
                  <strong>
                    {calibration.horizonWidths?.length
                      ? calibration.horizonWidths
                          .slice(0, 6)
                          .map((item) => `M${item.horizonMonth}: ${formatUnits(item.width80)}/${formatUnits(item.width95)}`)
                          .join(" | ")
                      : "Not available"}
                  </strong>
                </div>
              </div>
            </>
          ) : (
            <p className="notice compact-notice">Calibration metrics will appear after the next completed forecast run.</p>
          )}
        </article>

        <article className="analytics-panel">
          <div className="panel-heading compact">
            <div>
              <p className="eyebrow">Assumptions</p>
              <h2>Upcoming forecast events</h2>
            </div>
          </div>
          <div className="event-rule-list">
            {activeEvents.length > 0 ? (
              activeEvents.map((event) => (
                <div key={event.eventId || event.eventCode} className="event-rule">
                  <strong>{event.eventName}</strong>
                  <span>
                    {event.startDate} to {event.endDate} | {event.scope}
                    {event.scopeValue ? `: ${event.scopeValue}` : ""} | {event.upliftPct > 0 ? "+" : ""}
                    {event.upliftPct}%
                  </span>
                </div>
              ))
            ) : (
              <p className="notice compact-notice">No active events fall within the upcoming forecast horizon.</p>
            )}
          </div>
        </article>

        <article className="analytics-panel">
          <div className="panel-heading compact">
            <div>
              <p className="eyebrow">Execution</p>
              <h2>Latest generation output</h2>
            </div>
          </div>
          <div className="admin-detail-list">
            <div>
              <span>Current horizon</span>
              <strong>{generation?.horizon ? `${generation.horizon} months` : "Not running"}</strong>
            </div>
            <div>
              <span>Rows upserted</span>
              <strong>{formatUnits(generation?.inserted || 0)}</strong>
            </div>
            <div>
              <span>Rows removed</span>
              <strong>{formatUnits(generation?.removed || 0)}</strong>
            </div>
          </div>
        </article>
      </section>
    </>
  );
}
