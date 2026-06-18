import { randomUUID } from "node:crypto";
import { pool } from "../db.js";
import { buildCustomerServiceScopeFilter, getCustomerServiceScopes } from "./customerServiceAccess.js";

const validOwnershipDomains = new Set(["Sales", "Parts", "Service", "Warranty", "SLA", "Customer Service", "General"]);
const validSourceTypes = new Set(["Text", "Audio"]);
const validChannels = new Set(["Phone", "WhatsApp", "Email", "Chat", "Walk-in", "Other"]);

function serviceError(code, message, statusCode = 400) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function normalizeString(value) {
  const text = value == null ? "" : String(value).trim();
  return text || null;
}

function normalizeEnum(value, validValues, fallback) {
  const text = normalizeString(value);
  if (!text) return fallback;
  const found = [...validValues].find((item) => item.toLowerCase() === text.toLowerCase());
  if (!found) {
    throw serviceError("INVALID_ENUM", `Unsupported value '${text}'`);
  }
  return found;
}

function parsePositiveInt(value, fallback, max) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number) || number <= 0) return fallback;
  return Math.min(number, max);
}

function userCanSeeAllCustomerService(user) {
  return user?.role === "Admin" || user?.role === "National Head";
}

function hasNationalScope(user) {
  return getCustomerServiceScopes(user).some((scope) => scope.type === "National");
}

function buildReference() {
  const today = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  return `CST-${today}-${randomUUID().slice(0, 8).toUpperCase()}`;
}

function mapTranscript(row) {
  if (!row) return null;
  return {
    transcriptId: row.transcript_id,
    transcriptReference: row.transcript_reference,
    ownershipDomain: row.ownership_domain,
    sourceType: row.source_type,
    sourceReferenceId: row.source_reference_id,
    customerId: row.customer_id,
    customerName: row.customer_name,
    customerPhone: row.customer_phone,
    dealerId: row.dealer_id,
    serviceCenterId: row.service_center_id,
    serviceOrderId: row.service_order_id,
    modelId: row.model_id,
    variantId: row.variant_id,
    channel: row.channel,
    transcriptText: row.transcript_text,
    languageCode: row.language_code,
    transcriptDate: row.transcript_date,
    audioFileName: row.audio_file_name,
    audioStorageUri: row.audio_storage_uri,
    audioMimeType: row.audio_mime_type,
    audioDurationSeconds: row.audio_duration_seconds,
    speechToTextStatus: row.speech_to_text_status,
    speechToTextModel: row.speech_to_text_model,
    speechToTextError: row.speech_to_text_error,
    uploadedBy: row.uploaded_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    analysisStatus: row.analysis_status,
    sentiment: row.sentiment,
    primaryIntent: row.primary_intent,
    issueCategory: row.issue_category,
    severity: row.severity,
    escalationRisk: row.escalation_risk,
    slaBreachRisk: row.sla_breach_risk,
    confidenceScore: row.confidence_score
  };
}

function mapAnalysis(row) {
  if (!row) return null;
  return {
    analysisId: row.analysis_id,
    transcriptId: row.transcript_id,
    status: row.status,
    modelProvider: row.model_provider,
    modelName: row.model_name,
    modelVersion: row.model_version,
    sentiment: row.sentiment,
    sentimentScore: row.sentiment_score,
    primaryIntent: row.primary_intent,
    issueCategory: row.issue_category,
    issueSubcategory: row.issue_subcategory,
    severity: row.severity,
    resolutionStatus: row.resolution_status,
    escalationRisk: row.escalation_risk,
    slaBreachRisk: row.sla_breach_risk,
    customerEffortScore: row.customer_effort_score,
    summary: row.summary,
    recommendedAction: row.recommended_action,
    followUpRequired: row.follow_up_required,
    followUpDueDate: row.follow_up_due_date,
    confidenceScore: row.confidence_score,
    analysisJson: row.analysis_json,
    errorMessage: row.error_message,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapEntity(row) {
  return {
    entityId: row.entity_id,
    entityType: row.entity_type,
    entityValue: row.entity_value,
    confidenceScore: row.confidence_score,
    metadata: row.metadata
  };
}

function mapAction(row) {
  return {
    actionId: row.action_id,
    actionType: row.action_type,
    actionLabel: row.action_label,
    ownerTeam: row.owner_team,
    dueDate: row.due_date,
    priority: row.priority,
    status: row.status,
    metadata: row.metadata,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapJob(row) {
  return {
    jobId: row.job_id,
    transcriptId: row.transcript_id,
    status: row.status,
    attemptCount: row.attempt_count,
    maxAttempts: row.max_attempts,
    lockedBy: row.locked_by,
    lockedAt: row.locked_at,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    updatedAt: row.updated_at
  };
}

function mapAudit(row) {
  return {
    auditId: row.audit_id,
    transcriptId: row.transcript_id,
    actorUsername: row.actor_username,
    action: row.action,
    details: row.details,
    createdAt: row.created_at
  };
}

function normalizePayload(payload) {
  const transcriptText = normalizeString(payload.transcriptText ?? payload.transcript_text);
  const sourceType = normalizeEnum(payload.sourceType ?? payload.source_type, validSourceTypes, "Text");

  if (!transcriptText) {
    throw serviceError("TRANSCRIPT_REQUIRED", "Transcript text is required until speech-to-text ingestion is enabled");
  }

  return {
    ownershipDomain: normalizeEnum(payload.ownershipDomain ?? payload.ownership_domain, validOwnershipDomains, "Customer Service"),
    sourceType,
    sourceReferenceId: normalizeString(payload.sourceReferenceId ?? payload.source_reference_id),
    customerId: normalizeString(payload.customerId ?? payload.customer_id),
    customerName: normalizeString(payload.customerName ?? payload.customer_name),
    customerPhone: normalizeString(payload.customerPhone ?? payload.customer_phone),
    dealerId: normalizeString(payload.dealerId ?? payload.dealer_id),
    serviceCenterId: normalizeString(payload.serviceCenterId ?? payload.service_center_id),
    serviceOrderId: normalizeString(payload.serviceOrderId ?? payload.service_order_id),
    modelId: normalizeString(payload.modelId ?? payload.model_id),
    variantId: normalizeString(payload.variantId ?? payload.variant_id),
    channel: normalizeEnum(payload.channel, validChannels, "Phone"),
    transcriptText,
    languageCode: normalizeString(payload.languageCode ?? payload.language_code) || "en-IN",
    transcriptDate: normalizeString(payload.transcriptDate ?? payload.transcript_date),
    audioFileName: normalizeString(payload.audioFileName ?? payload.audio_file_name),
    audioStorageUri: normalizeString(payload.audioStorageUri ?? payload.audio_storage_uri),
    audioMimeType: normalizeString(payload.audioMimeType ?? payload.audio_mime_type),
    audioDurationSeconds: payload.audioDurationSeconds ?? payload.audio_duration_seconds ?? null,
    speechToTextStatus: normalizeString(payload.speechToTextStatus ?? payload.speech_to_text_status) || "not_required",
    speechToTextModel: normalizeString(payload.speechToTextModel ?? payload.speech_to_text_model),
    speechToTextError: normalizeString(payload.speechToTextError ?? payload.speech_to_text_error)
  };
}

async function audit(transcriptId, actorUsername, action, details = {}, db = pool) {
  await db.query(
    `
      INSERT INTO customer_service_audit_log (transcript_id, actor_username, action, details)
      VALUES ($1, $2, $3, $4::jsonb)
    `,
    [transcriptId, actorUsername || null, action, JSON.stringify(details)]
  );
}

async function ensureReadable(user, transcriptId, db = pool) {
  if (userCanSeeAllCustomerService(user) || hasNationalScope(user)) {
    const result = await db.query("SELECT 1 FROM customer_service_transcripts WHERE transcript_id = $1", [transcriptId]);
    if (result.rowCount === 0) throw serviceError("NOT_FOUND", "Transcript was not found", 404);
    return;
  }

  const values = [transcriptId];
  const scopeSql = buildCustomerServiceScopeFilter(user, values, "cst");
  const result = await db.query(
    `SELECT 1 FROM customer_service_transcripts cst WHERE cst.transcript_id = $1 AND ${scopeSql}`,
    values
  );
  if (result.rowCount === 0) {
    throw serviceError("NOT_FOUND", "Transcript was not found or is outside your access scope", 404);
  }
}

async function ensureWritableOwnership(user, transcript, db = pool) {
  if (userCanSeeAllCustomerService(user) || hasNationalScope(user)) return;

  if (!transcript.dealerId && !transcript.serviceCenterId) {
    throw serviceError("ACCESS_SCOPE_REQUIRED", "Dealer or service center is required for scoped users", 403);
  }

  const values = [];
  const scopeSql = buildCustomerServiceScopeFilter(user, values, "candidate");
  const result = await db.query(
    `
      SELECT 1
      FROM (
        SELECT $${values.length + 1}::VARCHAR AS dealer_id, $${values.length + 2}::VARCHAR AS service_center_id
      ) candidate
      WHERE ${scopeSql}
      LIMIT 1
    `,
    [...values, transcript.dealerId, transcript.serviceCenterId]
  );

  if (result.rowCount === 0) {
    throw serviceError("ACCESS_DENIED", "Transcript ownership is outside your access scope", 403);
  }
}

export async function createTranscript(payload, user, db = pool) {
  const transcript = normalizePayload(payload || {});
  await ensureWritableOwnership(user, transcript, db);

  const client = db === pool ? await pool.connect() : db;
  const shouldRelease = db === pool;
  try {
    if (shouldRelease) await client.query("BEGIN");

    const insertResult = await client.query(
      `
        INSERT INTO customer_service_transcripts (
          transcript_reference,
          ownership_domain,
          source_type,
          source_reference_id,
          customer_id,
          customer_name,
          customer_phone,
          dealer_id,
          service_center_id,
          service_order_id,
          model_id,
          variant_id,
          channel,
          transcript_text,
          language_code,
          transcript_date,
          audio_file_name,
          audio_storage_uri,
          audio_mime_type,
          audio_duration_seconds,
          speech_to_text_status,
          speech_to_text_model,
          speech_to_text_error,
          uploaded_by
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
          $11, $12, $13, $14, $15, COALESCE($16::TIMESTAMPTZ, NOW()),
          $17, $18, $19, $20, $21, $22, $23, $24
        )
        RETURNING *
      `,
      [
        buildReference(),
        transcript.ownershipDomain,
        transcript.sourceType,
        transcript.sourceReferenceId,
        transcript.customerId,
        transcript.customerName,
        transcript.customerPhone,
        transcript.dealerId,
        transcript.serviceCenterId,
        transcript.serviceOrderId,
        transcript.modelId,
        transcript.variantId,
        transcript.channel,
        transcript.transcriptText,
        transcript.languageCode,
        transcript.transcriptDate,
        transcript.audioFileName,
        transcript.audioStorageUri,
        transcript.audioMimeType,
        transcript.audioDurationSeconds,
        transcript.speechToTextStatus,
        transcript.speechToTextModel,
        transcript.speechToTextError,
        user?.username || null
      ]
    );

    const transcriptRow = insertResult.rows[0];
    let job = null;
    if (payload?.analyze !== false) {
      await client.query(
        `
          INSERT INTO customer_service_transcript_analysis (transcript_id, status)
          VALUES ($1, 'pending')
        `,
        [transcriptRow.transcript_id]
      );

      const jobResult = await client.query(
        `
          INSERT INTO customer_service_analysis_jobs (transcript_id, status)
          VALUES ($1, 'queued')
          RETURNING *
        `,
        [transcriptRow.transcript_id]
      );
      job = mapJob(jobResult.rows[0]);
    }

    await audit(transcriptRow.transcript_id, user?.username, "transcript.created", { analyze: payload?.analyze !== false }, client);
    if (job) {
      await audit(transcriptRow.transcript_id, user?.username, "analysis.queued", { jobId: job.jobId }, client);
    }

    if (shouldRelease) await client.query("COMMIT");

    return {
      ok: true,
      transcript: mapTranscript(transcriptRow),
      job
    };
  } catch (error) {
    if (shouldRelease) await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    if (shouldRelease) client.release();
  }
}

export async function listTranscripts(query, user, db = pool) {
  const limit = parsePositiveInt(query.limit || query.pageSize, 50, 200);
  const page = parsePositiveInt(query.page, 1, 100000);
  const offset = query.offset != null ? parsePositiveInt(query.offset, 0, 1000000) : (page - 1) * limit;

  const values = [];
  const where = [];

  if (!(userCanSeeAllCustomerService(user) || hasNationalScope(user))) {
    where.push(buildCustomerServiceScopeFilter(user, values, "cst"));
  }

  const filters = [
    ["ownershipDomain", "cst.ownership_domain"],
    ["dealerId", "cst.dealer_id"],
    ["serviceCenterId", "cst.service_center_id"],
    ["channel", "cst.channel"],
    ["severity", "analysis.severity"],
    ["escalationRisk", "analysis.escalation_risk"],
    ["slaBreachRisk", "analysis.sla_breach_risk"]
  ];

  for (const [key, column] of filters) {
    const value = normalizeString(query[key]);
    if (value) {
      values.push(value);
      where.push(`${column} = $${values.length}`);
    }
  }

  const statusFilter = normalizeString(query.status);
  if (statusFilter) {
    if (statusFilter === "not_queued") {
      where.push(`(
        analysis.analysis_id IS NULL
        OR (
          analysis.status = 'pending'
          AND NOT EXISTS (
            SELECT 1
            FROM customer_service_analysis_jobs status_job
            WHERE status_job.transcript_id = cst.transcript_id
          )
        )
      )`);
    } else if (statusFilter === "pending") {
      where.push(`(
        analysis.status = 'pending'
        AND EXISTS (
          SELECT 1
          FROM customer_service_analysis_jobs status_job
          WHERE status_job.transcript_id = cst.transcript_id
        )
      )`);
    } else {
      values.push(statusFilter);
      where.push(`analysis.status = $${values.length}`);
    }
  }

  if (normalizeString(query.fromDate)) {
    values.push(query.fromDate);
    where.push(`cst.transcript_date >= $${values.length}::TIMESTAMPTZ`);
  }
  if (normalizeString(query.toDate)) {
    values.push(query.toDate);
    where.push(`cst.transcript_date < ($${values.length}::DATE + INTERVAL '1 day')`);
  }
  if (normalizeString(query.search)) {
    values.push(`%${query.search.trim()}%`);
    where.push(`(
      cst.transcript_reference ILIKE $${values.length}
      OR cst.customer_name ILIKE $${values.length}
      OR cst.customer_phone ILIKE $${values.length}
      OR cst.transcript_text ILIKE $${values.length}
    )`);
  }

  const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
  const result = await db.query(
    `
      SELECT
        cst.*,
        CASE
          WHEN analysis.analysis_id IS NULL THEN 'not_queued'
          WHEN analysis.status = 'pending'
            AND NOT EXISTS (
              SELECT 1
              FROM customer_service_analysis_jobs status_job
              WHERE status_job.transcript_id = cst.transcript_id
            )
            THEN 'not_queued'
          ELSE analysis.status
        END AS analysis_status,
        analysis.sentiment,
        analysis.primary_intent,
        analysis.issue_category,
        analysis.severity,
        analysis.escalation_risk,
        analysis.sla_breach_risk,
        analysis.confidence_score,
        COUNT(*) OVER() AS total_count
      FROM customer_service_transcripts cst
      LEFT JOIN customer_service_transcript_analysis analysis ON analysis.transcript_id = cst.transcript_id
      ${whereSql}
      ORDER BY cst.transcript_date DESC, cst.transcript_id DESC
      LIMIT $${values.length + 1} OFFSET $${values.length + 2}
    `,
    [...values, limit, offset]
  );

  const totalRecords = Number(result.rows[0]?.total_count || 0);
  return {
    ok: true,
    pagination: {
      page,
      pageSize: limit,
      offset,
      totalRecords,
      totalPages: Math.max(1, Math.ceil(totalRecords / limit))
    },
    data: result.rows.map(mapTranscript)
  };
}

export async function getTranscriptDetail(transcriptId, user, db = pool) {
  await ensureReadable(user, transcriptId, db);

  const [transcriptResult, analysisResult, entitiesResult, actionsResult, jobsResult, auditResult] = await Promise.all([
    db.query("SELECT * FROM customer_service_transcripts WHERE transcript_id = $1", [transcriptId]),
    db.query("SELECT * FROM customer_service_transcript_analysis WHERE transcript_id = $1", [transcriptId]),
    db.query("SELECT * FROM customer_service_transcript_entities WHERE transcript_id = $1 ORDER BY entity_id", [transcriptId]),
    db.query("SELECT * FROM customer_service_transcript_actions WHERE transcript_id = $1 ORDER BY action_id", [transcriptId]),
    db.query("SELECT * FROM customer_service_analysis_jobs WHERE transcript_id = $1 ORDER BY job_id DESC", [transcriptId]),
    db.query("SELECT * FROM customer_service_audit_log WHERE transcript_id = $1 ORDER BY audit_id DESC LIMIT 100", [transcriptId])
  ]);

  return {
    ok: true,
    transcript: mapTranscript(transcriptResult.rows[0]),
    analysis: mapAnalysis(analysisResult.rows[0]),
    entities: entitiesResult.rows.map(mapEntity),
    actions: actionsResult.rows.map(mapAction),
    jobs: jobsResult.rows.map(mapJob),
    audit: auditResult.rows.map(mapAudit)
  };
}

export async function queueTranscriptAnalysis(transcriptId, user, db = pool) {
  await ensureReadable(user, transcriptId, db);

  const client = db === pool ? await pool.connect() : db;
  const shouldRelease = db === pool;
  try {
    if (shouldRelease) await client.query("BEGIN");

    await client.query(
      `
        INSERT INTO customer_service_transcript_analysis (transcript_id, status, error_message)
        VALUES ($1, 'pending', NULL)
        ON CONFLICT (transcript_id)
        DO UPDATE SET
          status = 'pending',
          error_message = NULL,
          updated_at = NOW()
      `,
      [transcriptId]
    );

    const jobResult = await client.query(
      `
        INSERT INTO customer_service_analysis_jobs (transcript_id, status)
        VALUES ($1, 'queued')
        RETURNING *
      `,
      [transcriptId]
    );

    await audit(transcriptId, user?.username, "analysis.queued", { jobId: jobResult.rows[0].job_id }, client);
    if (shouldRelease) await client.query("COMMIT");

    return {
      ok: true,
      job: mapJob(jobResult.rows[0])
    };
  } catch (error) {
    if (shouldRelease) await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    if (shouldRelease) client.release();
  }
}

export async function listAnalysisJobs(transcriptId, user, db = pool) {
  await ensureReadable(user, transcriptId, db);
  const result = await db.query(
    "SELECT * FROM customer_service_analysis_jobs WHERE transcript_id = $1 ORDER BY job_id DESC",
    [transcriptId]
  );
  return { ok: true, jobs: result.rows.map(mapJob) };
}

export async function listAuditLog(transcriptId, user, db = pool) {
  await ensureReadable(user, transcriptId, db);
  const result = await db.query(
    "SELECT * FROM customer_service_audit_log WHERE transcript_id = $1 ORDER BY audit_id DESC LIMIT 200",
    [transcriptId]
  );
  return { ok: true, audit: result.rows.map(mapAudit) };
}

export async function writeCustomerServiceAudit(transcriptId, actorUsername, action, details, db = pool) {
  await audit(transcriptId, actorUsername, action, details, db);
}
