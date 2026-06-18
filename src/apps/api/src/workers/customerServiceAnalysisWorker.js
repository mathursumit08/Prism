import { randomUUID } from "node:crypto";
import dotenv from "dotenv";
import { pool } from "../db.js";
import { analyzeCustomerServiceTranscript } from "../services/customerServiceAiService.js";
import { writeCustomerServiceAudit } from "../services/customerServiceTranscriptService.js";

dotenv.config();

const workerId = `customer-service-analysis-${randomUUID().slice(0, 8)}`;
const pollIntervalMs = Number.parseInt(process.env.CUSTOMER_SERVICE_ANALYSIS_POLL_MS || "30000", 10);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function claimNextJob(client) {
  const result = await client.query(
    `
      UPDATE customer_service_analysis_jobs
      SET status = 'processing',
          attempt_count = attempt_count + 1,
          locked_at = NOW(),
          locked_by = $1,
          started_at = COALESCE(started_at, NOW()),
          error_message = NULL,
          updated_at = NOW()
      WHERE job_id = (
        SELECT job_id
        FROM customer_service_analysis_jobs
        WHERE status IN ('queued', 'failed')
          AND attempt_count < max_attempts
        ORDER BY created_at ASC, job_id ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      RETURNING *
    `,
    [workerId]
  );

  return result.rows[0] || null;
}

async function fetchTranscript(client, transcriptId) {
  const result = await client.query(
    "SELECT * FROM customer_service_transcripts WHERE transcript_id = $1",
    [transcriptId]
  );
  return result.rows[0] || null;
}

async function replaceEntities(client, transcriptId, entities) {
  await client.query("DELETE FROM customer_service_transcript_entities WHERE transcript_id = $1", [transcriptId]);

  for (const entity of entities || []) {
    await client.query(
      `
        INSERT INTO customer_service_transcript_entities (
          transcript_id,
          entity_type,
          entity_value,
          normalized_value,
          confidence_score,
          metadata
        )
        VALUES ($1, $2, $3, $4, $5, $6::jsonb)
      `,
      [
        transcriptId,
        entity.entityType,
        entity.entityValue,
        entity.normalizedValue || null,
        entity.confidenceScore ?? null,
        JSON.stringify(entity.metadata || {})
      ]
    );
  }
}

async function replaceActions(client, transcriptId, actions) {
  await client.query("DELETE FROM customer_service_transcript_actions WHERE transcript_id = $1", [transcriptId]);

  for (const action of actions || []) {
    await client.query(
      `
        INSERT INTO customer_service_transcript_actions (
          transcript_id,
          action_type,
          action_label,
          owner_team,
          due_date,
          priority,
          metadata
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
      `,
      [
        transcriptId,
        action.actionType,
        action.actionLabel,
        action.ownerTeam || null,
        action.dueDate || null,
        action.priority || "medium",
        JSON.stringify(action.metadata || {})
      ]
    );
  }
}

async function markAnalysisProcessing(client, transcriptId) {
  await client.query(
    `
      UPDATE customer_service_transcript_analysis
      SET status = 'processing',
          error_message = NULL,
          started_at = COALESCE(started_at, NOW()),
          updated_at = NOW()
      WHERE transcript_id = $1
    `,
    [transcriptId]
  );
}

async function markAnalysisCompleted(client, transcriptId, result) {
  const analysis = result.analysis;
  await client.query(
    `
      UPDATE customer_service_transcript_analysis
      SET status = 'completed',
          model_provider = $2,
          model_name = $3,
          model_version = $4,
          sentiment = $5,
          sentiment_score = $6,
          primary_intent = $7,
          issue_category = $8,
          issue_subcategory = $9,
          severity = $10,
          resolution_status = $11,
          escalation_risk = $12,
          sla_breach_risk = $13,
          customer_effort_score = $14,
          summary = $15,
          recommended_action = $16,
          follow_up_required = $17,
          follow_up_due_date = $18,
          confidence_score = $19,
          analysis_json = $20::jsonb,
          error_message = NULL,
          completed_at = NOW(),
          updated_at = NOW()
      WHERE transcript_id = $1
    `,
    [
      transcriptId,
      result.provider,
      result.modelName,
      result.modelVersion,
      analysis.sentiment,
      analysis.sentimentScore,
      analysis.primaryIntent,
      analysis.issueCategory,
      analysis.issueSubcategory,
      analysis.severity,
      analysis.resolutionStatus,
      analysis.escalationRisk,
      analysis.slaBreachRisk,
      analysis.customerEffortScore,
      analysis.summary,
      analysis.recommendedAction,
      analysis.followUpRequired,
      analysis.followUpDueDate,
      analysis.confidenceScore,
      JSON.stringify(analysis)
    ]
  );
}

async function markJobCompleted(client, jobId) {
  await client.query(
    `
      UPDATE customer_service_analysis_jobs
      SET status = 'completed',
          completed_at = NOW(),
          updated_at = NOW()
      WHERE job_id = $1
    `,
    [jobId]
  );
}

async function markJobFailed(jobId, transcriptId, message) {
  await pool.query(
    `
      UPDATE customer_service_analysis_jobs
      SET status = 'failed',
          error_message = $2,
          completed_at = NOW(),
          updated_at = NOW()
      WHERE job_id = $1
    `,
    [jobId, message]
  );

  await pool.query(
    `
      UPDATE customer_service_transcript_analysis
      SET status = 'failed',
          error_message = $2,
          completed_at = NOW(),
          updated_at = NOW()
      WHERE transcript_id = $1
    `,
    [transcriptId, message]
  );

  await writeCustomerServiceAudit(transcriptId, null, "analysis.failed", {
    jobId,
    workerId,
    error: message
  });
}

async function processJob(job) {
  const transcript = await fetchTranscript(pool, job.transcript_id);
  if (!transcript) {
    throw new Error(`Transcript ${job.transcript_id} was not found`);
  }

  await markAnalysisProcessing(pool, transcript.transcript_id);
  const analysisResult = await analyzeCustomerServiceTranscript(transcript);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await replaceEntities(client, transcript.transcript_id, analysisResult.analysis.entities);
    await replaceActions(client, transcript.transcript_id, analysisResult.analysis.actions);
    await markAnalysisCompleted(client, transcript.transcript_id, analysisResult);
    await markJobCompleted(client, job.job_id);
    await writeCustomerServiceAudit(
      transcript.transcript_id,
      null,
      "analysis.completed",
      {
        jobId: job.job_id,
        workerId,
        modelProvider: analysisResult.provider,
        modelName: analysisResult.modelName
      },
      client
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function runCustomerServiceAnalysisWorker({ once = false } = {}) {
  console.log(`[customer-service-analysis] Worker ${workerId} started`);

  do {
    const client = await pool.connect();
    let job = null;
    try {
      await client.query("BEGIN");
      job = await claimNextJob(client);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      console.error("[customer-service-analysis] Could not claim job", error);
    } finally {
      client.release();
    }

    if (job) {
      try {
        await processJob(job);
        console.log(`[customer-service-analysis] Completed job ${job.job_id}`);
      } catch (error) {
        console.error(`[customer-service-analysis] Failed job ${job.job_id}`, error);
        await markJobFailed(job.job_id, job.transcript_id, error.message);
      }
    } else if (!once) {
      await sleep(Number.isFinite(pollIntervalMs) ? pollIntervalMs : 30000);
    }
  } while (!once);
}

