import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../auth/AuthContext.jsx";
import DismissibleMessage from "../components/DismissibleMessage.jsx";

const ownershipDomains = ["Customer Service", "Service", "Parts", "Warranty", "SLA", "Sales", "General"];
const channels = ["Phone", "WhatsApp", "Email", "Chat", "Walk-in", "Other"];
const statuses = ["", "not_queued", "pending", "processing", "completed", "failed"];
const activeAnalysisStatuses = new Set(["pending", "processing"]);
const configuredActiveRefreshMs = Number(import.meta.env.VITE_CUSTOMER_SERVICE_TRANSCRIPT_POLL_MS || 10000);
const activeRefreshMs = Number.isFinite(configuredActiveRefreshMs) && configuredActiveRefreshMs >= 3000
  ? configuredActiveRefreshMs
  : 10000;
const emptyForm = {
  ownershipDomain: "Customer Service",
  sourceType: "Text",
  sourceReferenceId: "",
  customerId: "",
  customerName: "",
  customerPhone: "",
  dealerId: "",
  serviceCenterId: "",
  serviceOrderId: "",
  modelId: "",
  variantId: "",
  channel: "Phone",
  transcriptDate: "",
  languageCode: "en-IN",
  transcriptText: "",
  audioFileName: "",
  audioStorageUri: "",
  audioMimeType: "",
  audioDurationSeconds: "",
  analyze: true
};

function formatDateTime(value) {
  if (!value) return "Not set";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
    year: "numeric"
  });
}

function sentenceCase(value) {
  const text = String(value || "").replaceAll("_", " ");
  if (!text) return "Not available";
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function riskClass(value) {
  const normalized = String(value || "").toLowerCase();
  if (normalized === "high" || normalized === "critical" || normalized === "failed") return "failed";
  if (normalized === "medium" || normalized === "processing" || normalized === "pending") return "running";
  return "healthy";
}

function buildQuery(filters) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value) params.set(key, value);
  });
  return params.toString();
}

function countBy(items, key) {
  return items.reduce((counts, item) => {
    const value = item[key] || "unknown";
    counts[value] = (counts[value] || 0) + 1;
    return counts;
  }, {});
}

function getEffectiveAnalysisStatus(detail) {
  const analysisStatus = detail?.analysis?.status;
  const hasJobs = (detail?.jobs || []).length > 0;
  if (!analysisStatus) return "not_queued";
  if (analysisStatus === "pending" && !hasJobs) return "not_queued";
  return analysisStatus;
}

function hasDisplayableAnalysis(detail) {
  const status = getEffectiveAnalysisStatus(detail);
  return Boolean(detail?.analysis && status !== "not_queued");
}

function getAnalyzeButtonLabel(detail) {
  const status = getEffectiveAnalysisStatus(detail);
  if (status === "not_queued") return "Analyze/Queue";
  if (status === "pending") return "Queued";
  if (status === "processing") return "Processing";
  return "Re-analyze";
}

function toApiPayload(form) {
  return {
    ...form,
    transcriptDate: form.transcriptDate || undefined,
    audioDurationSeconds: form.audioDurationSeconds ? Number(form.audioDurationSeconds) : undefined
  };
}

export default function CustomerServiceTranscriptsPage() {
  const { apiFetch, user } = useAuth();
  const canManage = user?.permissions?.includes("Manage Customer Service Transcripts");
  const canAnalyze = user?.permissions?.includes("Analyze Customer Service Transcripts");
  const [listState, setListState] = useState({
    loading: true,
    error: "",
    transcripts: [],
    pagination: null
  });
  const [detailState, setDetailState] = useState({
    loading: false,
    error: "",
    detail: null
  });
  const [filters, setFilters] = useState({
    status: "",
    severity: "",
    escalationRisk: "",
    search: ""
  });
  const [form, setForm] = useState(emptyForm);
  const [actionState, setActionState] = useState({
    loading: false,
    message: "",
    error: ""
  });

  const selectedTranscriptId = detailState.detail?.transcript?.transcriptId;
  const detailAnalysisStatus = getEffectiveAnalysisStatus(detailState.detail);
  const detailHasDisplayableAnalysis = hasDisplayableAnalysis(detailState.detail);
  const isSelectedAnalysisActive = activeAnalysisStatuses.has(detailAnalysisStatus);
  const detailActions = detailState.detail?.actions || [];
  const detailAudit = detailState.detail?.audit || [];
  const hasDetailActions = detailActions.length > 0;
  const counts = useMemo(() => countBy(listState.transcripts, "analysisStatus"), [listState.transcripts]);
  const hasActiveAnalysis = useMemo(
    () =>
      listState.transcripts.some((transcript) => activeAnalysisStatuses.has(transcript.analysisStatus)) ||
      activeAnalysisStatuses.has(getEffectiveAnalysisStatus(detailState.detail)),
    [detailState.detail, listState.transcripts]
  );
  const highRiskCount = useMemo(
    () =>
      listState.transcripts.filter(
        (transcript) => transcript.escalationRisk === "high" || transcript.slaBreachRisk === "high"
      ).length,
    [listState.transcripts]
  );

  useEffect(() => {
    loadTranscripts();
  }, []);

  useEffect(() => {
    if (!hasActiveAnalysis) {
      return undefined;
    }

    const intervalId = window.setInterval(async () => {
      await loadTranscripts(filters);
      if (selectedTranscriptId) {
        await loadDetail(selectedTranscriptId);
      }
    }, activeRefreshMs);

    return () => window.clearInterval(intervalId);
  }, [filters, hasActiveAnalysis, selectedTranscriptId]);

  async function loadTranscripts(nextFilters = filters) {
    setListState((current) => ({
      ...current,
      loading: true,
      error: ""
    }));

    try {
      const query = buildQuery({ ...nextFilters, pageSize: "50" });
      const response = await apiFetch(`/api/v1/customer-service/transcripts${query ? `?${query}` : ""}`);
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || "Unable to load customer service transcripts.");
      }

      setListState({
        loading: false,
        error: "",
        transcripts: payload.data || [],
        pagination: payload.pagination || null
      });

      const nextSelectedId = payload.data?.[0]?.transcriptId;
      if (!selectedTranscriptId && nextSelectedId) {
        await loadDetail(nextSelectedId);
      }
    } catch (error) {
      setListState((current) => ({
        ...current,
        loading: false,
        error: error.message || "Unable to load customer service transcripts."
      }));
    }
  }

  async function loadDetail(transcriptId) {
    setDetailState((current) => ({
      ...current,
      loading: true,
      error: ""
    }));

    try {
      const response = await apiFetch(`/api/v1/customer-service/transcripts/${transcriptId}`);
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || "Unable to load transcript detail.");
      }

      setDetailState({
        loading: false,
        error: "",
        detail: payload
      });
    } catch (error) {
      setDetailState((current) => ({
        ...current,
        loading: false,
        error: error.message || "Unable to load transcript detail."
      }));
    }
  }

  function updateFilter(field, value) {
    setFilters((current) => ({
      ...current,
      [field]: value
    }));
  }

  function updateForm(field, value) {
    setForm((current) => ({
      ...current,
      [field]: value
    }));
  }

  async function applyFilters(event) {
    event.preventDefault();
    await loadTranscripts(filters);
  }

  async function handleCreate(event) {
    event.preventDefault();
    setActionState({
      loading: true,
      message: "",
      error: ""
    });

    try {
      const response = await apiFetch("/api/v1/customer-service/transcripts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(toApiPayload(form))
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || "Unable to create transcript.");
      }

      setActionState({
        loading: false,
        message: payload.job ? "Transcript saved and analysis queued." : "Transcript saved.",
        error: ""
      });
      setForm(emptyForm);
      await loadTranscripts(filters);
      if (payload.transcript?.transcriptId) {
        await loadDetail(payload.transcript.transcriptId);
      }
    } catch (error) {
      setActionState({
        loading: false,
        message: "",
        error: error.message || "Unable to create transcript."
      });
    }
  }

  async function queueAnalysis(transcriptId) {
    setActionState({
      loading: true,
      message: "",
      error: ""
    });

    try {
      const response = await apiFetch(`/api/v1/customer-service/transcripts/${transcriptId}/analyze`, {
        method: "POST"
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || "Unable to queue transcript analysis.");
      }

      setActionState({
        loading: false,
        message: "Analysis queued.",
        error: ""
      });
      await loadDetail(transcriptId);
      await loadTranscripts(filters);
    } catch (error) {
      setActionState({
        loading: false,
        message: "",
        error: error.message || "Unable to queue transcript analysis."
      });
    }
  }

  return (
    <>
      <section className="dashboard-header customer-service-header">
        <div>
          <p className="eyebrow">Customer Service</p>
          <h1>Analyze service conversations.</h1>
          <p className="admin-header-copy">
            Capture text transcripts, queue asynchronous AI analysis, review sentiment, risks, recommended actions, and audit history.
          </p>
        </div>
        <div className="admin-hero-card">
          <span className="status-badge healthy">Transcript Ops</span>
          <strong>{listState.loading ? "Loading" : `${listState.pagination?.totalRecords || listState.transcripts.length} records`}</strong>
          <p>
            {hasActiveAnalysis
              ? "Refreshing active analysis jobs every 10 seconds."
              : `${highRiskCount} high-risk conversations in the current view.`}
          </p>
        </div>
      </section>

      {listState.error && (
        <DismissibleMessage onClose={() => setListState((current) => ({ ...current, error: "" }))}>
          {listState.error}
        </DismissibleMessage>
      )}
      {detailState.error && (
        <DismissibleMessage onClose={() => setDetailState((current) => ({ ...current, error: "" }))}>
          {detailState.error}
        </DismissibleMessage>
      )}
      {actionState.error && (
        <DismissibleMessage onClose={() => setActionState((current) => ({ ...current, error: "" }))}>
          {actionState.error}
        </DismissibleMessage>
      )}
      {actionState.message && (
        <DismissibleMessage kind="success" onClose={() => setActionState((current) => ({ ...current, message: "" }))}>
          {actionState.message}
        </DismissibleMessage>
      )}

      <section className="summary-grid customer-service-summary-grid" aria-label="Transcript analysis summary">
        <article className="metric">
          <span>Queued</span>
          <strong>{counts.pending || 0}</strong>
          <p>Waiting for worker analysis</p>
        </article>
        <article className="metric">
          <span>Processing</span>
          <strong>{counts.processing || 0}</strong>
          <p>Currently claimed by the worker</p>
        </article>
        <article className="metric">
          <span>Completed</span>
          <strong>{counts.completed || 0}</strong>
          <p>Analysis available for review</p>
        </article>
        <article className="metric">
          <span>High risk</span>
          <strong>{highRiskCount}</strong>
          <p>Escalation or SLA risk flagged</p>
        </article>
      </section>

      <section className="customer-service-workbench">
        {canManage && (
          <form className="forecast-event-form customer-transcript-form" onSubmit={handleCreate}>
            <div className="panel-heading compact">
              <div>
                <p className="eyebrow">New Transcript</p>
                <h2>Capture conversation</h2>
              </div>
            </div>

            <div className="customer-form-grid">
              <label>
                Ownership
                <select value={form.ownershipDomain} onChange={(event) => updateForm("ownershipDomain", event.target.value)}>
                  {ownershipDomains.map((domain) => (
                    <option key={domain} value={domain}>
                      {domain}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Channel
                <select value={form.channel} onChange={(event) => updateForm("channel", event.target.value)}>
                  {channels.map((channel) => (
                    <option key={channel} value={channel}>
                      {channel}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Service center
                <input value={form.serviceCenterId} onChange={(event) => updateForm("serviceCenterId", event.target.value)} placeholder="SVC001" />
              </label>
              <label>
                Dealer
                <input value={form.dealerId} onChange={(event) => updateForm("dealerId", event.target.value)} placeholder="DLR001" />
              </label>
              <label>
                Customer
                <input value={form.customerName} onChange={(event) => updateForm("customerName", event.target.value)} placeholder="Customer name" />
              </label>
              <label>
                Phone
                <input value={form.customerPhone} onChange={(event) => updateForm("customerPhone", event.target.value)} placeholder="Masked or full phone" />
              </label>
              <label>
                Service order
                <input value={form.serviceOrderId} onChange={(event) => updateForm("serviceOrderId", event.target.value)} placeholder="SO-1001" />
              </label>
              <label>
                Source reference
                <input value={form.sourceReferenceId} onChange={(event) => updateForm("sourceReferenceId", event.target.value)} placeholder="CRM ticket or call id" />
              </label>
              <label>
                Transcript date
                <input type="datetime-local" value={form.transcriptDate} onChange={(event) => updateForm("transcriptDate", event.target.value)} />
              </label>
              <label>
                Language
                <input value={form.languageCode} onChange={(event) => updateForm("languageCode", event.target.value)} placeholder="en-IN" />
              </label>
            </div>

            <div className="customer-audio-grid">
              <label>
                Audio file
                <input value={form.audioFileName} onChange={(event) => updateForm("audioFileName", event.target.value)} placeholder="Future upload metadata" />
              </label>
              <label>
                Audio URI
                <input value={form.audioStorageUri} onChange={(event) => updateForm("audioStorageUri", event.target.value)} placeholder="s3:// or storage path" />
              </label>
            </div>

            <label className="transcript-textarea-label">
              Transcript text
              <textarea
                value={form.transcriptText}
                onChange={(event) => updateForm("transcriptText", event.target.value)}
                placeholder="Paste the customer service transcript here."
                required
              />
            </label>

            <label className="event-active-toggle">
              <input
                type="checkbox"
                checked={form.analyze}
                onChange={(event) => updateForm("analyze", event.target.checked)}
              />
              Queue analysis after save
            </label>

            <div className="event-form-actions">
              <button type="submit" disabled={actionState.loading}>
                Save transcript
              </button>
              <button type="button" className="secondary-button" onClick={() => setForm(emptyForm)} disabled={actionState.loading}>
                Reset
              </button>
            </div>
          </form>
        )}

        <section className="forecast-event-table customer-transcript-list">
          <div className="panel-heading compact">
            <div>
              <p className="eyebrow">Transcript Queue</p>
              <h2>Analysis records</h2>
            </div>
            <button type="button" className="secondary-button" onClick={() => loadTranscripts(filters)} disabled={listState.loading}>
              Refresh
            </button>
          </div>

          <form className="customer-filter-grid" onSubmit={applyFilters}>
            <label>
              Status
              <select value={filters.status} onChange={(event) => updateFilter("status", event.target.value)}>
                {statuses.map((status) => (
                  <option key={status || "all"} value={status}>
                    {status ? sentenceCase(status) : "All"}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Severity
              <select value={filters.severity} onChange={(event) => updateFilter("severity", event.target.value)}>
                {["", "low", "medium", "high", "critical"].map((severity) => (
                  <option key={severity || "all"} value={severity}>
                    {severity ? sentenceCase(severity) : "All"}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Escalation
              <select value={filters.escalationRisk} onChange={(event) => updateFilter("escalationRisk", event.target.value)}>
                {["", "low", "medium", "high"].map((risk) => (
                  <option key={risk || "all"} value={risk}>
                    {risk ? sentenceCase(risk) : "All"}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Search
              <input value={filters.search} onChange={(event) => updateFilter("search", event.target.value)} placeholder="Customer, phone, text" />
            </label>
            <button type="submit" disabled={listState.loading}>
              Apply
            </button>
          </form>

          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Transcript Ref</th>
                  <th>Customer</th>
                  <th>Channel</th>
                  <th>Owner</th>
                  <th>Status</th>
                  <th>Sentiment</th>
                  <th>Severity</th>
                  <th>Escalation</th>
                  <th>SLA risk</th>
                  <th>Received</th>
                </tr>
              </thead>
              <tbody>
                {listState.transcripts.length > 0 ? (
                  listState.transcripts.map((transcript) => (
                    <tr
                      key={transcript.transcriptId}
                      className={selectedTranscriptId === transcript.transcriptId ? "selected-row" : ""}
                      onClick={() => loadDetail(transcript.transcriptId)}
                    >
                      <th>
                        <strong>{transcript.transcriptReference}</strong>
                      </th>
                      <td>{transcript.customerName || "Not captured"}</td>
                      <td>{transcript.channel || "Not captured"}</td>
                      <td>
                        {transcript.serviceCenterId || transcript.dealerId || transcript.ownershipDomain}
                      </td>
                      <td>
                        <span className={`status-badge ${riskClass(transcript.analysisStatus)}`}>
                          {sentenceCase(transcript.analysisStatus)}
                        </span>
                      </td>
                      <td>{sentenceCase(transcript.sentiment)}</td>
                      <td>{sentenceCase(transcript.severity)}</td>
                      <td>{sentenceCase(transcript.escalationRisk)}</td>
                      <td>{sentenceCase(transcript.slaBreachRisk)}</td>
                      <td>{formatDateTime(transcript.transcriptDate)}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan="11">{listState.loading ? "Loading transcripts..." : "No transcripts found."}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </section>

      <section className="customer-detail-grid" aria-label="Transcript analysis detail">
        <article className="forecast-panel">
          <div className="panel-heading compact">
            <div>
              <p className="eyebrow">Analysis</p>
              <h2>{detailState.detail?.transcript?.transcriptReference || "Select a transcript"}</h2>
            </div>
            {canAnalyze && detailState.detail?.transcript && (
              <button
                type="button"
                className="secondary-button"
                onClick={() => queueAnalysis(detailState.detail.transcript.transcriptId)}
                disabled={actionState.loading || isSelectedAnalysisActive}
              >
                {getAnalyzeButtonLabel(detailState.detail)}
              </button>
            )}
          </div>

          {detailState.loading ? (
            <div className="customer-empty-state">Loading analysis...</div>
          ) : detailHasDisplayableAnalysis ? (
            <div className="customer-analysis-panel">
              <div className="risk-grid">
                <div>
                  <span>Status</span>
                  <strong>{sentenceCase(detailAnalysisStatus)}</strong>
                </div>
                <div>
                  <span>Sentiment</span>
                  <strong>{sentenceCase(detailState.detail.analysis.sentiment)}</strong>
                </div>
                <div>
                  <span>Escalation</span>
                  <strong>{sentenceCase(detailState.detail.analysis.escalationRisk)}</strong>
                </div>
                <div>
                  <span>SLA Risk</span>
                  <strong>{sentenceCase(detailState.detail.analysis.slaBreachRisk)}</strong>
                </div>
              </div>
              <h3>Summary</h3>
              <p>{detailState.detail.analysis.summary || "Analysis summary is not available yet."}</p>
              <h3>Recommended action</h3>
              <p>{detailState.detail.analysis.recommendedAction || "No recommendation available yet."}</p>
              <div className="analysis-meta">
                <span>{detailState.detail.analysis.modelProvider || "Provider pending"}</span>
                <span>{detailState.detail.analysis.modelName || "Model pending"}</span>
                <span>Confidence {detailState.detail.analysis.confidenceScore ?? "pending"}</span>
              </div>
            </div>
          ) : (
            <div className="customer-empty-state">
              {detailState.detail?.transcript
                ? "This transcript has not been queued for analysis yet."
                : "Select a transcript to inspect analysis."}
            </div>
          )}
        </article>

        <article className="forecast-panel">
          <div className="panel-heading compact">
            <div>
              <p className="eyebrow">{hasDetailActions ? "Actions & History" : "History"}</p>
              <h2>{hasDetailActions ? "Follow-up trail" : "Activity history"}</h2>
            </div>
          </div>

          {hasDetailActions && (
            <div className="customer-action-list">
              {detailActions.map((action) => (
                <div key={action.actionId} className="customer-action-row">
                  <strong>{action.actionLabel}</strong>
                  <span>{sentenceCase(action.priority)} priority · {action.ownerTeam || "Unassigned"}</span>
                </div>
              ))}
            </div>
          )}

          <div className={`customer-audit-list ${!hasDetailActions ? "history-only" : ""}`}>
            {detailAudit.length > 0 ? (
              detailAudit.slice(0, 6).map((entry) => (
                <div key={entry.auditId}>
                  <strong>{entry.action}</strong>
                  <span>{formatDateTime(entry.createdAt)}</span>
                </div>
              ))
            ) : (
              <p className="muted-copy">Audit history will appear after transcript activity.</p>
            )}
          </div>
        </article>
      </section>
    </>
  );
}
