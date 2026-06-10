const defaultModel = "gpt-5.4-mini";
const defaultReasoningEffort = "low";

const analysisSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    sentiment: { type: "string", enum: ["positive", "neutral", "negative", "mixed"] },
    sentimentScore: { type: "number", minimum: -1, maximum: 1 },
    primaryIntent: { type: "string" },
    issueCategory: { type: "string" },
    issueSubcategory: { type: ["string", "null"] },
    severity: { type: "string", enum: ["low", "medium", "high", "critical"] },
    resolutionStatus: { type: "string", enum: ["resolved", "unresolved", "pending", "unknown"] },
    escalationRisk: { type: "string", enum: ["low", "medium", "high"] },
    slaBreachRisk: { type: "string", enum: ["low", "medium", "high"] },
    customerEffortScore: { type: "number", minimum: 1, maximum: 5 },
    summary: { type: "string" },
    recommendedAction: { type: "string" },
    followUpRequired: { type: "boolean" },
    followUpDueDate: { type: ["string", "null"] },
    confidenceScore: { type: "number", minimum: 0, maximum: 1 },
    entities: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          entityType: { type: "string" },
          entityValue: { type: "string" },
          confidenceScore: { type: "number", minimum: 0, maximum: 1 },
          metadata: {
            type: "object",
            additionalProperties: false,
            properties: {}
          }
        },
        required: ["entityType", "entityValue", "confidenceScore", "metadata"]
      }
    },
    actions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          actionType: { type: "string" },
          actionLabel: { type: "string" },
          ownerTeam: { type: ["string", "null"] },
          dueDate: { type: ["string", "null"] },
          priority: { type: "string", enum: ["low", "medium", "high", "urgent"] },
          metadata: {
            type: "object",
            additionalProperties: false,
            properties: {}
          }
        },
        required: ["actionType", "actionLabel", "ownerTeam", "dueDate", "priority", "metadata"]
      }
    }
  },
  required: [
    "sentiment",
    "sentimentScore",
    "primaryIntent",
    "issueCategory",
    "issueSubcategory",
    "severity",
    "resolutionStatus",
    "escalationRisk",
    "slaBreachRisk",
    "customerEffortScore",
    "summary",
    "recommendedAction",
    "followUpRequired",
    "followUpDueDate",
    "confidenceScore",
    "entities",
    "actions"
  ]
};

function clamp(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.min(max, Math.max(min, number));
}

function pickRisk(text) {
  const normalized = text.toLowerCase();
  if (/(angry|urgent|legal|complaint|third time|again|delay|breakdown|unsafe|accident|refund)/i.test(normalized)) {
    return "high";
  }
  if (/(waiting|callback|pending|late|not resolved|issue|problem|noise|leak|warning)/i.test(normalized)) {
    return "medium";
  }
  return "low";
}

function buildHeuristicAnalysis(transcript) {
  const text = transcript.transcript_text || "";
  const risk = pickRisk(text);
  const sentiment = risk === "high" ? "negative" : risk === "medium" ? "mixed" : "neutral";
  const followUpRequired = risk !== "low" || /(call back|callback|pending|waiting|not resolved)/i.test(text);
  const issueCategory = /(warranty|claim)/i.test(text)
    ? "Warranty"
    : /(part|spare|battery|brake|tyre|tire)/i.test(text)
      ? "Parts"
      : /(service|repair|appointment|workshop)/i.test(text)
        ? "Service"
        : "General Support";

  return {
    provider: "LocalStub",
    modelName: "heuristic-transcript-analyzer",
    modelVersion: "development-fallback",
    analysis: {
      sentiment,
      sentimentScore: sentiment === "negative" ? -0.65 : sentiment === "mixed" ? -0.2 : 0,
      primaryIntent: "Customer support request",
      issueCategory,
      issueSubcategory: null,
      severity: risk === "high" ? "high" : risk === "medium" ? "medium" : "low",
      resolutionStatus: /(resolved|fixed|closed|completed)/i.test(text) ? "resolved" : "pending",
      escalationRisk: risk,
      slaBreachRisk: risk,
      customerEffortScore: risk === "high" ? 4.5 : risk === "medium" ? 3.2 : 2,
      summary: text.length > 220 ? `${text.slice(0, 217)}...` : text,
      recommendedAction: followUpRequired
        ? "Assign owner and follow up with the customer before the next business day."
        : "Log the interaction and monitor for repeat contact.",
      followUpRequired,
      followUpDueDate: null,
      confidenceScore: 0.55,
      entities: [
        transcript.service_center_id
          ? {
              entityType: "service_center_id",
              entityValue: transcript.service_center_id,
              confidenceScore: 1,
              metadata: {}
            }
          : null,
        transcript.dealer_id
          ? {
              entityType: "dealer_id",
              entityValue: transcript.dealer_id,
              confidenceScore: 1,
              metadata: {}
            }
          : null
      ].filter(Boolean),
      actions: followUpRequired
        ? [
            {
              actionType: "follow_up",
              actionLabel: "Follow up with customer",
              ownerTeam: "Service",
              dueDate: null,
              priority: risk === "high" ? "urgent" : "medium",
              metadata: {}
            }
          ]
        : []
    }
  };
}

function extractOutputText(payload) {
  if (payload.output_text) return payload.output_text;

  for (const output of payload.output || []) {
    for (const content of output.content || []) {
      if (content.type === "output_text" && content.text) return content.text;
      if (content.text) return content.text;
    }
  }

  return null;
}

function normalizeAnalysis(raw) {
  return {
    sentiment: raw.sentiment,
    sentimentScore: clamp(raw.sentimentScore, -1, 1),
    primaryIntent: raw.primaryIntent,
    issueCategory: raw.issueCategory,
    issueSubcategory: raw.issueSubcategory || null,
    severity: raw.severity,
    resolutionStatus: raw.resolutionStatus,
    escalationRisk: raw.escalationRisk,
    slaBreachRisk: raw.slaBreachRisk,
    customerEffortScore: clamp(raw.customerEffortScore, 1, 5),
    summary: raw.summary,
    recommendedAction: raw.recommendedAction,
    followUpRequired: Boolean(raw.followUpRequired),
    followUpDueDate: raw.followUpDueDate || null,
    confidenceScore: clamp(raw.confidenceScore, 0, 1),
    entities: Array.isArray(raw.entities) ? raw.entities : [],
    actions: Array.isArray(raw.actions) ? raw.actions : []
  };
}

export async function analyzeCustomerServiceTranscript(transcript) {
  const apiKey = process.env.OPENAI_API_KEY;
  const aiMode = (process.env.CUSTOMER_SERVICE_AI_MODE || "").trim().toLowerCase();

  if (!apiKey || aiMode === "stub") {
    return buildHeuristicAnalysis(transcript);
  }

  const model = process.env.OPENAI_TRANSCRIPT_MODEL || defaultModel;
  const reasoningEffort = process.env.OPENAI_TRANSCRIPT_REASONING_EFFORT || defaultReasoningEffort;
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: "system",
          content:
            "Analyze customer service transcripts for automotive sales, service, parts, warranty, and SLA operations. Return only schema-compliant JSON."
        },
        {
          role: "user",
          content: JSON.stringify({
            transcriptId: transcript.transcript_id,
            ownershipDomain: transcript.ownership_domain,
            sourceType: transcript.source_type,
            dealerId: transcript.dealer_id,
            serviceCenterId: transcript.service_center_id,
            serviceOrderId: transcript.service_order_id,
            modelId: transcript.model_id,
            variantId: transcript.variant_id,
            channel: transcript.channel,
            languageCode: transcript.language_code,
            transcriptDate: transcript.transcript_date,
            transcriptText: transcript.transcript_text
          })
        }
      ],
      reasoning: { effort: reasoningEffort },
      text: {
        format: {
          type: "json_schema",
          name: "customer_service_transcript_analysis",
          schema: analysisSchema,
          strict: true
        }
      }
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI transcript analysis failed (${response.status}): ${errorText}`);
  }

  const payload = await response.json();
  const outputText = extractOutputText(payload);
  if (!outputText) {
    throw new Error("OpenAI transcript analysis returned no output text");
  }

  const parsed = JSON.parse(outputText);
  return {
    provider: "OpenAI",
    modelName: model,
    modelVersion: payload.model || model,
    analysis: normalizeAnalysis(parsed)
  };
}
