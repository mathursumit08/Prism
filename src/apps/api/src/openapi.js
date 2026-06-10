const forecastQueryParameters = [
  {
    in: "query",
    name: "startDate",
    schema: { format: "date", type: "string" },
    description: "Inclusive forecast start date in YYYY-MM-DD format."
  },
  {
    in: "query",
    name: "endDate",
    schema: { format: "date", type: "string" },
    description: "Inclusive forecast end date in YYYY-MM-DD format."
  },
  {
    in: "query",
    name: "region",
    schema: { type: "string" },
    description: "Regional filter. For regional forecasts this maps to the forecast group."
  },
  {
    in: "query",
    name: "segment",
    schema: { type: "string" },
    description: "Vehicle segment filter."
  },
  {
    in: "query",
    name: "groupId",
    schema: { type: "string" },
    description: "Forecast group filter. For blended forecasts this can identify a dealer."
  },
  {
    in: "query",
    name: "modelId",
    schema: { type: "string" },
    description: "Vehicle model filter."
  },
  {
    in: "query",
    name: "variantId",
    schema: { type: "string" },
    description: "Vehicle variant filter."
  },
  {
    in: "query",
    name: "horizon",
    schema: { minimum: 1, maximum: 60, type: "integer" },
    description: "Maximum number of forecast months per series."
  },
  {
    in: "query",
    name: "page",
    schema: { default: 1, minimum: 1, type: "integer" },
    description: "Results page number."
  },
  {
    in: "query",
    name: "pageSize",
    schema: { default: 100, minimum: 1, maximum: 1000, type: "integer" },
    description: "Results page size."
  }
];

const forecastResponseSchema = {
  type: "object",
  properties: {
    ok: { type: "boolean" },
    endpoint: { type: "string" },
    runId: { type: "integer" },
    completedAt: { format: "date-time", type: "string" },
    filters: {
      type: "object",
      properties: {
        startDate: { format: "date", nullable: true, type: "string" },
        endDate: { format: "date", nullable: true, type: "string" },
        region: { nullable: true, type: "string" },
        groupId: { nullable: true, type: "string" },
        segment: { nullable: true, type: "string" },
        modelId: { nullable: true, type: "string" },
        variantId: { nullable: true, type: "string" },
        horizon: { nullable: true, type: "integer" },
        page: { type: "integer" },
        pageSize: { type: "integer" }
      }
    },
    pagination: {
      type: "object",
      properties: {
        page: { type: "integer" },
        pageSize: { type: "integer" },
        totalPages: { type: "integer" },
        totalRecords: { type: "integer" }
      }
    },
    modelWeights: {
      type: "object",
      properties: {
        dealer: { type: "number" },
        zone: { type: "number" }
      },
      description: "For blended forecasts, the average inverse-MAPE ensemble weights applied to dealer-level and zone-level model outputs."
    },
    data: {
      type: "array",
      items: {
        type: "object",
        properties: {
          forecastType: { type: "string" },
          level: { type: "string" },
          sourceLevel: { type: "string" },
          groupId: { type: "string" },
          groupLabel: { type: "string" },
          segment: { nullable: true, type: "string" },
          modelId: { nullable: true, type: "string" },
          variantId: { nullable: true, type: "string" },
          forecastDate: { format: "date", type: "string" },
          horizonMonth: { nullable: true, type: "integer" },
          units: { type: "number" },
          lower_80: { type: "number" },
          upper_80: { type: "number" },
          lower_95: { type: "number" },
          upper_95: { type: "number" },
          dataQuality: { enum: ["rich", "sparse", "fallback"], type: "string" },
          biasCorrection: { type: "number" },
          method: { nullable: true, type: "string" },
          validation: {
            type: "object",
            properties: {
              mae: { nullable: true, type: "number" },
              rmse: { nullable: true, type: "number" },
              mape: { nullable: true, type: "number" }
            }
          }
        }
      }
    }
  }
};

const forecastMetricsResponseSchema = {
  type: "object",
  properties: {
    ok: { type: "boolean" },
    window: { enum: [1, 3, 6], type: "integer" },
    filters: {
      type: "object",
      properties: {
        level: { enum: ["dealer", "state", "zone"], nullable: true, type: "string" },
        groupId: { nullable: true, type: "string" },
        segment: { nullable: true, type: "string" },
        modelId: { nullable: true, type: "string" },
        variantId: { nullable: true, type: "string" }
      }
    },
    metrics: {
      type: "array",
      items: {
        type: "object",
        properties: {
          level: { type: "string" },
          groupId: { type: "string" },
          groupLabel: { type: "string" },
          segment: { nullable: true, type: "string" },
          modelId: { nullable: true, type: "string" },
          variantId: { nullable: true, type: "string" },
          avgMape: { nullable: true, type: "number" },
          avgRmse: { nullable: true, type: "number" },
          avgMae: { nullable: true, type: "number" },
          bias: { nullable: true, type: "number" },
          biasCorrection: { nullable: true, type: "number" },
          sampleCount: { type: "integer" }
        }
      }
    }
  }
};

const forecastMetricAnalyticsParameters = [
  {
    in: "query",
    name: "level",
    schema: { enum: ["dealer", "state", "zone"], type: "string" },
    description: "Forecast hierarchy level for matched forecast-vs-actual diagnostics."
  },
  {
    in: "query",
    name: "groupId",
    schema: { type: "string" },
    description: "Optional dealer, state, or zone identifier within the selected level."
  },
  {
    in: "query",
    name: "segment",
    schema: { type: "string" },
    description: "Optional vehicle segment filter."
  },
  {
    in: "query",
    name: "modelId",
    schema: { type: "string" },
    description: "Optional vehicle model filter."
  },
  {
    in: "query",
    name: "variantId",
    schema: { type: "string" },
    description: "Optional vehicle variant filter."
  },
  {
    in: "query",
    name: "window",
    schema: { default: 6, enum: [1, 3, 6, 12, 24], type: "integer" },
    description: "Number of recent actualized months to include."
  }
];

const aftersalesDomainParameter = {
  in: "path",
  name: "domain",
  required: true,
  schema: { enum: ["parts", "service", "warranty", "sla"], type: "string" },
  description: "Aftersales forecast domain."
};

const aftersalesForecastParameters = [
  {
    in: "query",
    name: "level",
    schema: { enum: ["service_center", "state", "zone"], type: "string" },
    description: "Aftersales hierarchy level."
  },
  {
    in: "query",
    name: "groupId",
    schema: { type: "string" },
    description: "Optional service center, state, or zone identifier."
  },
  {
    in: "query",
    name: "startDate",
    schema: { format: "date", type: "string" },
    description: "Inclusive forecast start date in YYYY-MM-DD format."
  },
  {
    in: "query",
    name: "endDate",
    schema: { format: "date", type: "string" },
    description: "Inclusive forecast end date in YYYY-MM-DD format."
  },
  {
    in: "query",
    name: "horizon",
    schema: { minimum: 1, maximum: 60, type: "integer" },
    description: "Maximum number of forecast months per series."
  },
  {
    in: "query",
    name: "breakdown",
    schema: { enum: ["part_category", "part", "service_type", "job_category", "claim_type", "return_reason", "age_bucket"], type: "string" },
    description: "Optional breakdown dimension for segment split and forecast data views."
  },
  { in: "query", name: "partId", schema: { type: "string" }, description: "Parts-domain SKU filter." },
  { in: "query", name: "partCategory", schema: { type: "string" }, description: "Parts-domain category filter." },
  { in: "query", name: "serviceType", schema: { type: "string" }, description: "Service or SLA service type filter." },
  { in: "query", name: "jobCategory", schema: { type: "string" }, description: "Service or SLA job category filter." },
  { in: "query", name: "claimType", schema: { type: "string" }, description: "Warranty claim type filter." },
  { in: "query", name: "returnReason", schema: { type: "string" }, description: "Warranty return reason filter." },
  { in: "query", name: "ageBucket", schema: { type: "string" }, description: "Warranty product or vehicle age bucket filter." },
  { in: "query", name: "modelId", schema: { type: "string" }, description: "Vehicle model filter." },
  { in: "query", name: "variantId", schema: { type: "string" }, description: "Vehicle variant filter." }
];

const aftersalesDiagnosticsParameters = [
  aftersalesDomainParameter,
  ...aftersalesForecastParameters.filter((parameter) => !["startDate", "endDate", "horizon", "breakdown"].includes(parameter.name)),
  {
    in: "query",
    name: "window",
    schema: { default: 6, enum: [1, 3, 6, 12, 24], type: "integer" },
    description: "Number of recent actualized months to include."
  },
  {
    in: "query",
    name: "limit",
    schema: { default: 500, minimum: 1, maximum: 1000, type: "integer" },
    description: "Maximum matched observations to return."
  }
];

const aftersalesForecastResponseSchema = {
  type: "object",
  properties: {
    ok: { type: "boolean" },
    domain: { enum: ["parts", "service", "warranty", "sla"], type: "string" },
    forecastType: { type: "string" },
    runId: { type: "integer" },
    horizon: { type: "integer" },
    completedAt: { format: "date-time", type: "string" },
    filters: { type: "object" },
    series: {
      type: "array",
      items: {
        type: "object",
        properties: {
          level: { type: "string" },
          groupId: { type: "string" },
          groupLabel: { type: "string" },
          partId: { nullable: true, type: "string" },
          partCategory: { nullable: true, type: "string" },
          serviceType: { nullable: true, type: "string" },
          jobCategory: { nullable: true, type: "string" },
          claimType: { nullable: true, type: "string" },
          returnReason: { nullable: true, type: "string" },
          ageBucket: { nullable: true, type: "string" },
          forecast: {
            type: "array",
            items: {
              type: "object",
              properties: {
                month: { format: "date", type: "string" },
                units: { type: "number" },
                unitsSold: { type: "number" },
                lower_80: { type: "number" },
                upper_80: { type: "number" },
                lower_95: { type: "number" },
                upper_95: { type: "number" },
                expectedBreaches: { nullable: true, type: "number" },
                breachProbability: { nullable: true, type: "number" },
                riskScore: { nullable: true, type: "number" },
                riskLevel: { nullable: true, enum: ["Low", "Medium", "High", "Critical"], type: "string" }
              }
            }
          },
          validation: { type: "object" }
        }
      }
    }
  }
};

const aftersalesReferenceResponseSchema = {
  type: "object",
  properties: {
    ok: { type: "boolean" },
    serviceCenters: { type: "array", items: { type: "object" } },
    parts: { type: "array", items: { type: "object" } },
    serviceTypes: { type: "array", items: { type: "string" } },
    jobCategories: { type: "array", items: { type: "string" } },
    claimTypes: { type: "array", items: { type: "string" } },
    returnReasons: { type: "array", items: { type: "string" } },
    ageBuckets: { type: "array", items: { type: "string" } }
  }
};

const forecastMetricTrendResponseSchema = {
  type: "object",
  properties: {
    ok: { type: "boolean" },
    filters: { type: "object" },
    trend: {
      type: "array",
      items: {
        type: "object",
        properties: {
          month: { format: "date", type: "string" },
          mape: { nullable: true, type: "number" },
          mae: { nullable: true, type: "number" },
          rmse: { nullable: true, type: "number" },
          bias: { nullable: true, type: "number" },
          biasPct: { nullable: true, type: "number" },
          sampleCount: { type: "integer" }
        }
      }
    }
  }
};

const forecastObservationSchema = {
  type: "object",
  properties: {
    level: { type: "string" },
    groupId: { type: "string" },
    groupLabel: { type: "string" },
    segment: { nullable: true, type: "string" },
    modelId: { nullable: true, type: "string" },
    variantId: { nullable: true, type: "string" },
    month: { format: "date", type: "string" },
    forecastUnits: { type: "number" },
    actualUnits: { type: "number" },
    error: { type: "number" },
    absoluteError: { type: "number" },
    percentageError: { nullable: true, type: "number" },
    absolutePercentageError: { nullable: true, type: "number" },
    lower80: { type: "number" },
    upper80: { type: "number" },
    lower95: { type: "number" },
    upper95: { type: "number" },
    validationMape: { nullable: true, type: "number" },
    validationRmse: { nullable: true, type: "number" },
    validationMae: { nullable: true, type: "number" }
  }
};

const forecastObservationResponseSchema = {
  type: "object",
  properties: {
    ok: { type: "boolean" },
    filters: { type: "object" },
    limit: { type: "integer" },
    observations: {
      type: "array",
      items: forecastObservationSchema
    }
  }
};

const forecastErrorHistogramResponseSchema = {
  type: "object",
  properties: {
    ok: { type: "boolean" },
    filters: { type: "object" },
    bucketSize: { type: "integer" },
    buckets: {
      type: "array",
      items: {
        type: "object",
        properties: {
          minErrorPct: { type: "number" },
          maxErrorPct: { type: "number" },
          count: { type: "integer" }
        }
      }
    }
  }
};

const forecastAccuracyLeaderboardResponseSchema = {
  type: "object",
  properties: {
    ok: { type: "boolean" },
    filters: { type: "object" },
    leaderboard: {
      type: "array",
      items: {
        type: "object",
        properties: {
          rank: { type: "integer" },
          level: { type: "string" },
          groupId: { type: "string" },
          groupLabel: { type: "string" },
          mape: { nullable: true, type: "number" },
          mae: { nullable: true, type: "number" },
          rmse: { nullable: true, type: "number" },
          bias: { nullable: true, type: "number" },
          biasPct: { nullable: true, type: "number" },
          sampleCount: { type: "integer" }
        }
      }
    }
  }
};

const calibrationHistoryResponseSchema = {
  type: "object",
  properties: {
    ok: { type: "boolean" },
    limit: { type: "integer" },
    runs: {
      type: "array",
      items: {
        type: "object",
        properties: {
          runId: { type: "integer" },
          forecastType: { type: "string" },
          horizonMonths: { type: "integer" },
          completedAt: { format: "date-time", type: "string" },
          coverage80: { nullable: true, type: "number" },
          coverage95: { nullable: true, type: "number" },
          avgWidth80: { nullable: true, type: "number" },
          avgWidth95: { nullable: true, type: "number" },
          sampleCount: { type: "integer" }
        }
      }
    }
  }
};

const dashboardCardSchema = {
  type: "object",
  properties: {
    key: { type: "string" },
    label: { type: "string" },
    category: { enum: ["KPIs", "Graphs", "Tables"], type: "string" },
    displayOrder: { type: "integer" },
    enabled: { type: "boolean" },
    updatedAt: { format: "date-time", type: "string" }
  }
};

const dashboardCardsResponseSchema = {
  type: "object",
  properties: {
    ok: { type: "boolean" },
    cards: {
      type: "array",
      items: dashboardCardSchema
    }
  }
};

const forecastEventSchema = {
  type: "object",
  properties: {
    eventId: { type: "integer" },
    forecastDomain: { enum: ["Sales", "Parts", "Service", "Warranty", "SLA"], type: "string" },
    forecastType: { type: "string" },
    eventCode: { type: "string" },
    eventName: { type: "string" },
    eventType: { enum: ["Festive", "Regulatory", "Promotional", "Holiday", "Other"], type: "string" },
    scope: { enum: ["National", "Zone", "State", "Service Center"], type: "string" },
    scopeValue: { nullable: true, type: "string" },
    startDate: { format: "date", type: "string" },
    endDate: { format: "date", type: "string" },
    upliftPct: { minimum: -100, maximum: 200, type: "number" },
    isActive: { type: "boolean" },
    createdAt: { format: "date-time", type: "string" },
    updatedAt: { format: "date-time", type: "string" }
  }
};

const forecastEventRequestSchema = {
  type: "object",
  required: ["forecast_domain", "event_code", "event_name", "event_type", "scope", "start_date", "end_date", "uplift_pct"],
  properties: {
    forecast_domain: { enum: ["Sales", "Parts", "Service", "Warranty", "SLA"], type: "string" },
    event_code: { type: "string" },
    event_name: { type: "string" },
    event_type: { enum: ["Festive", "Regulatory", "Promotional", "Holiday", "Other"], type: "string" },
    scope: { enum: ["National", "Zone", "State", "Service Center"], type: "string" },
    scope_value: { nullable: true, type: "string" },
    start_date: { format: "date", type: "string" },
    end_date: { format: "date", type: "string" },
    uplift_pct: { minimum: -100, maximum: 200, type: "number" },
    is_active: { default: true, type: "boolean" }
  }
};

const salesKpiResponseSchema = {
  type: "object",
  properties: {
    ok: { type: "boolean" },
    filters: { type: "object" },
    window: { type: "object" },
    kpis: { type: "object" }
  }
};

const dealerReferenceResponseSchema = {
  type: "object",
  properties: {
    ok: { type: "boolean" },
    dealers: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          region: { type: "string" },
          city: { type: "string" },
          state: { type: "string" },
          dealerType: { type: "string" },
          salesCapacityPerMonth: { type: "number" }
        }
      }
    }
  }
};

const modelReferenceResponseSchema = {
  type: "object",
  properties: {
    ok: { type: "boolean" },
    models: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          manufacturer: { type: "string" },
          segment: { type: "string" },
          launchYear: { type: "number" },
          isActive: { type: "boolean" },
          isDiscontinued: { type: "boolean" }
        }
      }
    }
  }
};

const variantReferenceResponseSchema = {
  type: "object",
  properties: {
    ok: { type: "boolean" },
    variants: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          modelId: { type: "string" },
          name: { type: "string" },
          fuelType: { type: "string" },
          transmission: { type: "string" },
          exShowroomPrice: { type: "number" },
          isActive: { type: "boolean" },
          isDiscontinued: { type: "boolean" }
        }
      }
    }
  }
};

const customerServiceTranscriptSchema = {
  type: "object",
  properties: {
    transcriptId: { type: "integer" },
    transcriptReference: { type: "string" },
    ownershipDomain: { enum: ["Sales", "Parts", "Service", "Warranty", "SLA", "Customer Service", "General"], type: "string" },
    sourceType: { enum: ["Text", "Audio"], type: "string" },
    sourceReferenceId: { nullable: true, type: "string" },
    customerId: { nullable: true, type: "string" },
    customerName: { nullable: true, type: "string" },
    customerPhone: { nullable: true, type: "string" },
    dealerId: { nullable: true, type: "string" },
    serviceCenterId: { nullable: true, type: "string" },
    serviceOrderId: { nullable: true, type: "string" },
    modelId: { nullable: true, type: "string" },
    variantId: { nullable: true, type: "string" },
    channel: { enum: ["Phone", "WhatsApp", "Email", "Chat", "Walk-in", "Other"], type: "string" },
    transcriptText: { type: "string" },
    languageCode: { type: "string" },
    transcriptDate: { format: "date-time", type: "string" },
    audioFileName: { nullable: true, type: "string" },
    audioStorageUri: { nullable: true, type: "string" },
    audioMimeType: { nullable: true, type: "string" },
    audioDurationSeconds: { nullable: true, type: "integer" },
    speechToTextStatus: { enum: ["not_required", "pending", "processing", "completed", "failed"], type: "string" },
    uploadedBy: { nullable: true, type: "string" },
    analysisStatus: { nullable: true, type: "string" },
    sentiment: { nullable: true, type: "string" },
    severity: { nullable: true, type: "string" },
    escalationRisk: { nullable: true, type: "string" },
    slaBreachRisk: { nullable: true, type: "string" },
    createdAt: { format: "date-time", type: "string" },
    updatedAt: { format: "date-time", type: "string" }
  }
};

const customerServiceTranscriptCreateSchema = {
  type: "object",
  required: ["transcriptText"],
  properties: {
    ownershipDomain: { default: "Customer Service", enum: ["Sales", "Parts", "Service", "Warranty", "SLA", "Customer Service", "General"], type: "string" },
    sourceType: { default: "Text", enum: ["Text", "Audio"], type: "string" },
    sourceReferenceId: { type: "string" },
    customerId: { type: "string" },
    customerName: { type: "string" },
    customerPhone: { type: "string" },
    dealerId: { type: "string" },
    serviceCenterId: { type: "string" },
    serviceOrderId: { type: "string" },
    modelId: { type: "string" },
    variantId: { type: "string" },
    channel: { default: "Phone", enum: ["Phone", "WhatsApp", "Email", "Chat", "Walk-in", "Other"], type: "string" },
    transcriptText: { type: "string" },
    languageCode: { default: "en-IN", type: "string" },
    transcriptDate: { format: "date-time", type: "string" },
    audioFileName: { type: "string" },
    audioStorageUri: { type: "string" },
    audioMimeType: { type: "string" },
    audioDurationSeconds: { type: "integer" },
    analyze: { default: true, type: "boolean" }
  }
};

const customerServiceAnalysisSchema = {
  type: "object",
  properties: {
    analysisId: { type: "integer" },
    transcriptId: { type: "integer" },
    status: { enum: ["pending", "processing", "completed", "failed"], type: "string" },
    modelProvider: { nullable: true, type: "string" },
    modelName: { nullable: true, type: "string" },
    sentiment: { nullable: true, enum: ["positive", "neutral", "negative", "mixed"], type: "string" },
    sentimentScore: { nullable: true, type: "number" },
    primaryIntent: { nullable: true, type: "string" },
    issueCategory: { nullable: true, type: "string" },
    severity: { nullable: true, enum: ["low", "medium", "high", "critical"], type: "string" },
    resolutionStatus: { nullable: true, enum: ["resolved", "unresolved", "pending", "unknown"], type: "string" },
    escalationRisk: { nullable: true, enum: ["low", "medium", "high"], type: "string" },
    slaBreachRisk: { nullable: true, enum: ["low", "medium", "high"], type: "string" },
    customerEffortScore: { nullable: true, type: "number" },
    summary: { nullable: true, type: "string" },
    recommendedAction: { nullable: true, type: "string" },
    followUpRequired: { type: "boolean" },
    followUpDueDate: { nullable: true, format: "date", type: "string" },
    confidenceScore: { nullable: true, type: "number" }
  }
};

const customerServiceJobSchema = {
  type: "object",
  properties: {
    jobId: { type: "integer" },
    transcriptId: { type: "integer" },
    status: { enum: ["queued", "processing", "completed", "failed"], type: "string" },
    attemptCount: { type: "integer" },
    maxAttempts: { type: "integer" },
    lockedBy: { nullable: true, type: "string" },
    errorMessage: { nullable: true, type: "string" },
    createdAt: { format: "date-time", type: "string" },
    startedAt: { nullable: true, format: "date-time", type: "string" },
    completedAt: { nullable: true, format: "date-time", type: "string" }
  }
};

const customerServiceAuditSchema = {
  type: "object",
  properties: {
    auditId: { type: "integer" },
    transcriptId: { nullable: true, type: "integer" },
    actorUsername: { nullable: true, type: "string" },
    action: { type: "string" },
    details: { type: "object" },
    createdAt: { format: "date-time", type: "string" }
  }
};

const customerServiceListParameters = [
  { in: "query", name: "ownershipDomain", schema: { type: "string" } },
  { in: "query", name: "dealerId", schema: { type: "string" } },
  { in: "query", name: "serviceCenterId", schema: { type: "string" } },
  { in: "query", name: "channel", schema: { type: "string" } },
  { in: "query", name: "status", schema: { type: "string" } },
  { in: "query", name: "severity", schema: { type: "string" } },
  { in: "query", name: "escalationRisk", schema: { type: "string" } },
  { in: "query", name: "fromDate", schema: { format: "date", type: "string" } },
  { in: "query", name: "toDate", schema: { format: "date", type: "string" } },
  { in: "query", name: "search", schema: { type: "string" } },
  { in: "query", name: "page", schema: { default: 1, type: "integer" } },
  { in: "query", name: "pageSize", schema: { default: 50, maximum: 200, type: "integer" } }
];

function buildForecastPath(summary, description) {
  return {
    get: {
      summary,
      description,
      tags: ["Forecasts"],
      security: [{ bearerAuth: [] }],
      parameters: forecastQueryParameters,
      responses: {
        200: {
          description: "Forecast response",
          content: {
            "application/json": {
              schema: forecastResponseSchema
            }
          }
        },
        400: {
          description: "Invalid query parameters"
        },
        401: {
          description: "Authentication required"
        },
        403: {
          description: "Permission denied"
        }
      }
    }
  };
}

function buildLegacyForecastPath(summary, description) {
  return {
    get: {
      summary,
      description,
      tags: ["Forecasts"],
      security: [{ bearerAuth: [] }],
      parameters: [
        {
          in: "query",
          name: "level",
          schema: {
            enum: ["dealer", "state", "zone"],
            type: "string"
          }
        },
        {
          in: "query",
          name: "groupId",
          schema: { type: "string" }
        },
        {
          in: "query",
          name: "segment",
          schema: { type: "string" }
        },
        {
          in: "query",
          name: "modelId",
          schema: { type: "string" }
        },
        {
          in: "query",
          name: "variantId",
          schema: { type: "string" }
        },
        {
          in: "query",
          name: "breakdown",
          schema: { enum: ["segment"], type: "string" }
        }
      ],
      responses: {
        200: {
          description: "Forecast series response"
        },
        400: {
          description: "Invalid query parameters"
        },
        401: {
          description: "Authentication required"
        },
        403: {
          description: "Permission denied"
        }
      }
    }
  };
}

function buildAftersalesDomainPath(summary, description, schema = aftersalesForecastResponseSchema, extraParameters = []) {
  return {
    get: {
      summary,
      description,
      tags: ["Forecasts"],
      security: [{ bearerAuth: [] }],
      parameters: [aftersalesDomainParameter, ...extraParameters],
      responses: {
        200: {
          description: "Aftersales forecast response",
          content: {
            "application/json": {
              schema
            }
          }
        },
        400: { description: "Invalid query parameters" },
        401: { description: "Authentication required" },
        403: { description: "Permission denied" },
        404: { description: "Unsupported domain or no completed run" }
      }
    }
  };
}

function buildJsonRequestBody(schema, description) {
  return {
    required: true,
    content: {
      "application/json": {
        schema,
        ...(description ? { example: description } : {})
      }
    }
  };
}

export function buildOpenApiSpec(baseUrl = "http://localhost:4000") {
  return {
    openapi: "3.1.0",
    info: {
      title: "Prism Forecast API",
      version: "1.0.0",
      description: "Versioned forecast endpoints for frontend integration."
    },
    servers: [{ url: baseUrl }],
    tags: [{ name: "Auth" }, { name: "Forecasts" }, { name: "Customer Service" }, { name: "References" }, { name: "System" }],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT"
        }
      }
    },
    paths: {
      "/api/v1/auth/login": {
        post: {
          summary: "Login",
          description: "Authenticates a user, returns an access token, and sets a refresh token cookie.",
          tags: ["Auth"],
          security: [],
          requestBody: buildJsonRequestBody(
            {
              type: "object",
              required: ["username", "password"],
              properties: {
                username: { type: "string" },
                password: { type: "string" }
              }
            },
            {
              username: "",
              password: ""
            }
          ),
          responses: {
            200: {
              description: "Authenticated successfully"
            },
            400: {
              description: "Username and password are required"
            },
            401: {
              description: "Invalid username or password"
            }
          }
        }
      },
      "/api/v1/auth/refresh": {
        post: {
          summary: "Refresh access token",
          description: "Uses the HttpOnly refresh token cookie to issue a new access token.",
          tags: ["Auth"],
          security: [],
          responses: {
            200: {
              description: "Access token refreshed successfully"
            },
            401: {
              description: "Refresh token is missing, invalid, or expired"
            }
          }
        }
      },
      "/api/v1/auth/logout": {
        post: {
          summary: "Logout",
          description: "Revokes the refresh token cookie and ends the current session.",
          tags: ["Auth"],
          security: [],
          responses: {
            200: {
              description: "Logged out successfully"
            }
          }
        }
      },
      "/api/v1/auth/me": {
        get: {
          summary: "Current user session",
          description: "Returns the current authenticated user profile from the bearer token.",
          tags: ["Auth"],
          security: [{ bearerAuth: [] }],
          responses: {
            200: {
              description: "Current user profile"
            },
            401: {
              description: "Authentication required"
            }
          }
        }
      },
      "/api/v1/health": {
        get: {
          summary: "API health check",
          description: "Returns a lightweight API liveness response.",
          tags: ["System"],
          security: [],
          responses: {
            200: {
              description: "API is running"
            }
          }
        }
      },
      "/api/v1/db-check": {
        get: {
          summary: "Database connectivity check",
          description: "Checks whether the API can query the configured database.",
          tags: ["System"],
          security: [],
          responses: {
            200: { description: "Database connection is healthy" },
            500: { description: "Database connection failed" }
          }
        }
      },
      "/api/v1/dealers": {
        get: {
          summary: "Dealer references",
          description: "Returns active dealer reference values within the signed-in user's Sales access scope.",
          tags: ["References"],
          security: [{ bearerAuth: [] }],
          parameters: [
            { in: "query", name: "city", schema: { type: "string" } },
            { in: "query", name: "dealerType", schema: { type: "string" } },
            { in: "query", name: "region", schema: { type: "string" } },
            { in: "query", name: "state", schema: { type: "string" } },
            { in: "query", name: "limit", schema: { default: 1000, maximum: 1000, type: "integer" } },
            { in: "query", name: "offset", schema: { default: 0, minimum: 0, type: "integer" } }
          ],
          responses: {
            200: {
              description: "Dealer reference response",
              content: {
                "application/json": {
                  schema: dealerReferenceResponseSchema
                }
              }
            },
            401: { description: "Authentication required" },
            403: { description: "Permission denied" }
          }
        }
      },
      "/api/v1/models": {
        get: {
          summary: "Vehicle model references",
          description: "Returns active, non-discontinued vehicle models for Sales forecast filters.",
          tags: ["References"],
          security: [{ bearerAuth: [] }],
          parameters: [
            { in: "query", name: "manufacturer", schema: { type: "string" } },
            { in: "query", name: "segment", schema: { type: "string" } },
            { in: "query", name: "limit", schema: { default: 1000, maximum: 1000, type: "integer" } },
            { in: "query", name: "offset", schema: { default: 0, minimum: 0, type: "integer" } }
          ],
          responses: {
            200: {
              description: "Vehicle model reference response",
              content: {
                "application/json": {
                  schema: modelReferenceResponseSchema
                }
              }
            },
            401: { description: "Authentication required" },
            403: { description: "Permission denied" }
          }
        }
      },
      "/api/v1/variants": {
        get: {
          summary: "Vehicle variant references",
          description: "Returns active, non-discontinued vehicle variants for Sales forecast filters.",
          tags: ["References"],
          security: [{ bearerAuth: [] }],
          parameters: [
            { in: "query", name: "fuelType", schema: { type: "string" } },
            { in: "query", name: "modelId", schema: { type: "string" } },
            { in: "query", name: "transmission", schema: { type: "string" } },
            { in: "query", name: "limit", schema: { default: 1000, maximum: 1000, type: "integer" } },
            { in: "query", name: "offset", schema: { default: 0, minimum: 0, type: "integer" } }
          ],
          responses: {
            200: {
              description: "Vehicle variant reference response",
              content: {
                "application/json": {
                  schema: variantReferenceResponseSchema
                }
              }
            },
            401: { description: "Authentication required" },
            403: { description: "Permission denied" }
          }
        }
      },
      "/api/v1/forecasts/dealer-targets": buildForecastPath(
        "Dealer target forecasts",
        "Returns dealer-level target forecast records."
      ),
      "/api/v1/forecasts/baseline": buildLegacyForecastPath(
        "Baseline forecast series",
        "Returns the latest stored baseline forecast in the original dashboard response shape."
      ),
      "/api/v1/forecasts/actuals": buildLegacyForecastPath(
        "Actuals series",
        "Returns the historical actuals data in the original dashboard response shape."
      ),
      "/api/v1/forecasts/metrics": {
        get: {
          summary: "Forecast accuracy metrics",
          description: "Returns rolling MAPE, RMSE, MAE, and bias metrics by forecast entity.",
          tags: ["Forecasts"],
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              in: "query",
              name: "level",
              schema: { enum: ["dealer", "state", "zone"], type: "string" }
            },
            {
              in: "query",
              name: "groupId",
              schema: { type: "string" }
            },
            {
              in: "query",
              name: "segment",
              schema: { type: "string" }
            },
            {
              in: "query",
              name: "modelId",
              schema: { type: "string" }
            },
            {
              in: "query",
              name: "variantId",
              schema: { type: "string" }
            },
            {
              in: "query",
              name: "window",
              schema: { default: 6, enum: [1, 3, 6], type: "integer" }
            }
          ],
          responses: {
            200: {
              description: "Forecast accuracy metrics response",
              content: {
                "application/json": {
                  schema: forecastMetricsResponseSchema
                }
              }
            },
            400: {
              description: "Invalid query parameters"
            },
            401: {
              description: "Authentication required"
            },
            403: {
              description: "Permission denied"
            }
          }
        }
      },
      "/api/v1/forecasts/metrics/trend": {
        get: {
          summary: "Forecast metric trend",
          description: "Returns month-level MAPE, MAE, RMSE, bias, and sample counts from matched forecast and actual observations.",
          tags: ["Forecasts"],
          security: [{ bearerAuth: [] }],
          parameters: forecastMetricAnalyticsParameters,
          responses: {
            200: {
              description: "Forecast metric trend response",
              content: {
                "application/json": {
                  schema: forecastMetricTrendResponseSchema
                }
              }
            },
            400: { description: "Invalid query parameters" },
            401: { description: "Authentication required" },
            403: { description: "Permission denied" }
          }
        }
      },
      "/api/v1/forecasts/metrics/observations": {
        get: {
          summary: "Matched forecast and actual observations",
          description: "Returns individual matched forecast-vs-actual points for scatter plots and detailed error diagnostics.",
          tags: ["Forecasts"],
          security: [{ bearerAuth: [] }],
          parameters: [
            ...forecastMetricAnalyticsParameters,
            {
              in: "query",
              name: "limit",
              schema: { default: 500, minimum: 1, maximum: 1000, type: "integer" },
              description: "Maximum number of observations to return."
            }
          ],
          responses: {
            200: {
              description: "Matched observation response",
              content: {
                "application/json": {
                  schema: forecastObservationResponseSchema
                }
              }
            },
            400: { description: "Invalid query parameters" },
            401: { description: "Authentication required" },
            403: { description: "Permission denied" }
          }
        }
      },
      "/api/v1/forecasts/metrics/histogram": {
        get: {
          summary: "Forecast error histogram",
          description: "Returns percentage-error buckets from matched forecast and actual observations.",
          tags: ["Forecasts"],
          security: [{ bearerAuth: [] }],
          parameters: [
            ...forecastMetricAnalyticsParameters,
            {
              in: "query",
              name: "bucketSize",
              schema: { default: 10, minimum: 5, maximum: 50, type: "integer" },
              description: "Percentage-point width of each error bucket."
            }
          ],
          responses: {
            200: {
              description: "Forecast error histogram response",
              content: {
                "application/json": {
                  schema: forecastErrorHistogramResponseSchema
                }
              }
            },
            400: { description: "Invalid query parameters" },
            401: { description: "Authentication required" },
            403: { description: "Permission denied" }
          }
        }
      },
      "/api/v1/forecasts/metrics/leaderboard": {
        get: {
          summary: "Forecast accuracy leaderboard",
          description: "Returns forecast groups ranked by lowest MAPE, with MAE, RMSE, bias, and sample count.",
          tags: ["Forecasts"],
          security: [{ bearerAuth: [] }],
          parameters: forecastMetricAnalyticsParameters,
          responses: {
            200: {
              description: "Forecast accuracy leaderboard response",
              content: {
                "application/json": {
                  schema: forecastAccuracyLeaderboardResponseSchema
                }
              }
            },
            400: { description: "Invalid query parameters" },
            401: { description: "Authentication required" },
            403: { description: "Permission denied" }
          }
        }
      },
      "/api/v1/forecasts/dashboard-cards": {
        get: {
          summary: "Forecast dashboard card settings",
          description: "Returns the global card visibility settings used by forecast dashboards. Use the optional domain query to fetch Sales, Parts, Service, Warranty, or SLA settings only.",
          tags: ["Forecasts"],
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              in: "query",
              name: "domain",
              schema: { enum: ["Sales", "Parts", "Service", "Warranty", "SLA"], type: "string" },
              description: "Optional dashboard card domain."
            }
          ],
          responses: {
            200: {
              description: "Forecast dashboard card settings response",
              content: {
                "application/json": {
                  schema: dashboardCardsResponseSchema
                }
              }
            },
            401: { description: "Authentication required" },
            403: { description: "Permission denied" }
          }
        }
      },
      "/api/v1/forecasts/kpis": {
        get: {
          summary: "Sales forecast KPI cards",
          description: "Returns Sales dashboard KPI card values such as forecast accuracy, actuals versus forecast, bias, and inventory coverage.",
          tags: ["Forecasts"],
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              in: "query",
              name: "level",
              schema: { enum: ["dealer", "state", "zone"], type: "string" }
            },
            { in: "query", name: "groupId", schema: { type: "string" } },
            { in: "query", name: "segment", schema: { type: "string" } },
            { in: "query", name: "modelId", schema: { type: "string" } },
            { in: "query", name: "variantId", schema: { type: "string" } },
            { in: "query", name: "window", schema: { default: 6, enum: [1, 3, 6, 12, 24], type: "integer" } }
          ],
          responses: {
            200: {
              description: "Sales KPI response",
              content: {
                "application/json": {
                  schema: salesKpiResponseSchema
                }
              }
            },
            400: { description: "Invalid query parameters" },
            401: { description: "Authentication required" },
            403: { description: "Permission denied" }
          }
        }
      },
      "/api/v1/forecasts/regional": buildForecastPath(
        "Regional forecasts",
        "Returns regional forecast records using zone-level stored forecasts."
      ),
      "/api/v1/forecasts/national": buildForecastPath(
        "National forecasts",
        "Returns national forecast records aggregated from regional forecasts."
      ),
      "/api/v1/forecasts/blended": buildForecastPath(
        "Blended forecasts",
        "Returns dealer-level forecasts blended with the dealer's allocated share of zone-level output. Dealer and zone contributions are weighted by inverse recent hold-out MAPE, so lower-MAPE model outputs receive higher weight."
      ),
      "/api/v1/forecasts/{domain}": buildAftersalesDomainPath(
        "Aftersales domain forecast",
        "Returns the latest completed Parts, Service, Warranty, or SLA forecast series for the selected service-center hierarchy and filters.",
        aftersalesForecastResponseSchema,
        aftersalesForecastParameters
      ),
      "/api/v1/forecasts/{domain}/references": buildAftersalesDomainPath(
        "Aftersales domain references",
        "Returns service centers and domain-specific filter values allowed for the signed-in user's access scope.",
        aftersalesReferenceResponseSchema
      ),
      "/api/v1/forecasts/{domain}/actuals": buildAftersalesDomainPath(
        "Aftersales domain actuals",
        "Returns recent actual monthly history for Parts, Service, Warranty, or SLA in the same response shape used by dashboard actual-vs-forecast charts.",
        aftersalesForecastResponseSchema,
        aftersalesForecastParameters
      ),
      "/api/v1/forecasts/{domain}/diagnostics": buildAftersalesDomainPath(
        "Aftersales domain diagnostics",
        "Returns MAPE, MAE, RMSE, bias trend, matched observations, error buckets, and leaderboard rows for Parts, Service, Warranty, or SLA.",
        {
          type: "object",
          properties: {
            ok: { type: "boolean" },
            domain: { enum: ["parts", "service", "warranty", "sla"], type: "string" },
            filters: { type: "object" },
            trend: forecastMetricTrendResponseSchema.properties.trend,
            observations: forecastObservationResponseSchema.properties.observations,
            buckets: forecastErrorHistogramResponseSchema.properties.buckets,
            leaderboard: forecastAccuracyLeaderboardResponseSchema.properties.leaderboard
          }
        },
        aftersalesDiagnosticsParameters.filter((parameter) => parameter.name !== "domain")
      ),
      "/api/v1/forecasts/{domain}/kpis": buildAftersalesDomainPath(
        "Aftersales domain KPIs",
        "Returns domain KPI cards such as fill rate, MTTR, return rate, and service cost actuals versus forecast.",
        {
          type: "object",
          properties: {
            ok: { type: "boolean" },
            domain: { enum: ["parts", "service", "warranty", "sla"], type: "string" },
            filters: { type: "object" },
            window: { type: "object" },
            kpis: { type: "object" }
          }
        },
        aftersalesForecastParameters
      ),
      "/api/v1/customer-service/transcripts": {
        get: {
          summary: "List customer service transcripts",
          description: "Returns customer service transcript records visible to the signed-in user's access scopes.",
          tags: ["Customer Service"],
          security: [{ bearerAuth: [] }],
          parameters: customerServiceListParameters,
          responses: {
            200: {
              description: "Transcript list response",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      ok: { type: "boolean" },
                      pagination: { type: "object" },
                      data: {
                        type: "array",
                        items: customerServiceTranscriptSchema
                      }
                    }
                  }
                }
              }
            },
            401: { description: "Authentication required" },
            403: { description: "Permission denied" }
          }
        },
        post: {
          summary: "Create customer service transcript",
          description: "Creates a text transcript and queues asynchronous analysis by default. Audio metadata is accepted for future speech-to-text ingestion, but transcriptText is currently required.",
          tags: ["Customer Service"],
          security: [{ bearerAuth: [] }],
          requestBody: buildJsonRequestBody(customerServiceTranscriptCreateSchema, {
            ownershipDomain: "Service",
            sourceType: "Text",
            serviceCenterId: "SVC001",
            channel: "Phone",
            transcriptText: "Customer called about a delayed repair and requested an urgent callback.",
            analyze: true
          }),
          responses: {
            202: {
              description: "Transcript created and analysis queued",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      ok: { type: "boolean" },
                      transcript: customerServiceTranscriptSchema,
                      job: customerServiceJobSchema
                    }
                  }
                }
              }
            },
            400: { description: "Invalid transcript payload" },
            401: { description: "Authentication required" },
            403: { description: "Permission denied or ownership outside scope" }
          }
        }
      },
      "/api/v1/customer-service/transcripts/{transcriptId}": {
        get: {
          summary: "Get customer service transcript detail",
          description: "Returns transcript detail, latest analysis, extracted entities, actions, jobs, and recent audit entries.",
          tags: ["Customer Service"],
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              in: "path",
              name: "transcriptId",
              required: true,
              schema: { type: "integer" }
            }
          ],
          responses: {
            200: {
              description: "Transcript detail response",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      ok: { type: "boolean" },
                      transcript: customerServiceTranscriptSchema,
                      analysis: customerServiceAnalysisSchema,
                      entities: { type: "array", items: { type: "object" } },
                      actions: { type: "array", items: { type: "object" } },
                      jobs: { type: "array", items: customerServiceJobSchema },
                      audit: { type: "array", items: customerServiceAuditSchema }
                    }
                  }
                }
              }
            },
            401: { description: "Authentication required" },
            403: { description: "Permission denied" },
            404: { description: "Transcript not found or outside scope" }
          }
        }
      },
      "/api/v1/customer-service/transcripts/{transcriptId}/analyze": {
        post: {
          summary: "Queue customer service transcript analysis",
          description: "Queues a transcript for asynchronous AI analysis.",
          tags: ["Customer Service"],
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              in: "path",
              name: "transcriptId",
              required: true,
              schema: { type: "integer" }
            }
          ],
          responses: {
            202: {
              description: "Analysis job queued",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      ok: { type: "boolean" },
                      job: customerServiceJobSchema
                    }
                  }
                }
              }
            },
            401: { description: "Authentication required" },
            403: { description: "Permission denied" },
            404: { description: "Transcript not found or outside scope" }
          }
        }
      },
      "/api/v1/customer-service/transcripts/{transcriptId}/jobs": {
        get: {
          summary: "List customer service analysis jobs",
          tags: ["Customer Service"],
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              in: "path",
              name: "transcriptId",
              required: true,
              schema: { type: "integer" }
            }
          ],
          responses: {
            200: {
              description: "Analysis jobs",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      ok: { type: "boolean" },
                      jobs: { type: "array", items: customerServiceJobSchema }
                    }
                  }
                }
              }
            },
            401: { description: "Authentication required" },
            403: { description: "Permission denied" },
            404: { description: "Transcript not found or outside scope" }
          }
        }
      },
      "/api/v1/customer-service/transcripts/{transcriptId}/audit": {
        get: {
          summary: "List customer service transcript audit log",
          tags: ["Customer Service"],
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              in: "path",
              name: "transcriptId",
              required: true,
              schema: { type: "integer" }
            }
          ],
          responses: {
            200: {
              description: "Audit log",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      ok: { type: "boolean" },
                      audit: { type: "array", items: customerServiceAuditSchema }
                    }
                  }
                }
              }
            },
            401: { description: "Authentication required" },
            403: { description: "Permission denied" },
            404: { description: "Transcript not found or outside scope" }
          }
        }
      },
      "/api/v1/forecasts/admin/status": {
        get: {
          summary: "Forecast admin status",
          tags: ["Forecasts"],
          security: [{ bearerAuth: [] }],
          responses: {
            200: { description: "Current forecast administration status" },
            401: { description: "Authentication required" },
            403: { description: "Permission denied" }
          }
        }
      },
      "/api/v1/forecasts/admin/calibration-history": {
        get: {
          summary: "Forecast calibration history",
          description: "Returns completed forecast run calibration coverage and interval-width history for admin charts.",
          tags: ["Forecasts"],
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              in: "query",
              name: "limit",
              schema: { default: 12, minimum: 1, maximum: 1000, type: "integer" },
              description: "Maximum number of completed runs to return."
            }
          ],
          responses: {
            200: {
              description: "Forecast calibration history response",
              content: {
                "application/json": {
                  schema: calibrationHistoryResponseSchema
                }
              }
            },
            400: { description: "Invalid query parameters" },
            401: { description: "Authentication required" },
            403: { description: "Permission denied" }
          }
        }
      },
      "/api/v1/forecasts/admin/dashboard-cards": {
        put: {
          summary: "Update forecast dashboard cards",
          description: "Updates global forecast dashboard card visibility. This endpoint is restricted to Admin users.",
          tags: ["Forecasts"],
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["cards"],
                  properties: {
                    cards: {
                      type: "array",
                      items: {
                        type: "object",
                        required: ["domain", "key", "enabled"],
                        properties: {
                          domain: { enum: ["Sales", "Parts", "Service", "Warranty", "SLA"], type: "string" },
                          key: { type: "string" },
                          enabled: { type: "boolean" }
                        }
                      }
                    }
                  }
                }
              }
            }
          },
          responses: {
            200: {
              description: "Updated dashboard card settings",
              content: {
                "application/json": {
                  schema: dashboardCardsResponseSchema
                }
              }
            },
            400: { description: "Invalid dashboard card payload" },
            401: { description: "Authentication required" },
            403: { description: "Admin role required" }
          }
        }
      },
      "/api/v1/forecasts/admin/clear": {
        post: {
          summary: "Clear future forecast rows",
          description: "Deletes stored baseline forecast rows that do not yet have matching actual sales months. Actualized historical forecast rows are preserved for metrics and bias correction.",
          tags: ["Forecasts"],
          security: [{ bearerAuth: [] }],
          responses: {
            200: { description: "Forecast rows cleared" },
            401: { description: "Authentication required" },
            403: { description: "Permission denied" },
            409: { description: "A regeneration run is already in progress" }
          }
        }
      },
      "/api/v1/forecasts/admin/regenerate": {
        post: {
          summary: "Regenerate forecasts",
          tags: ["Forecasts"],
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: false,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    horizon: {
                      enum: [6, 12, 24],
                      type: "integer"
                    }
                  }
                }
              }
            }
          },
          responses: {
            202: { description: "Forecast regeneration started" },
            400: { description: "Invalid horizon" },
            401: { description: "Authentication required" },
            403: { description: "Permission denied" },
            409: { description: "A regeneration run is already in progress" }
          }
        }
      },
      "/api/v1/forecasts/admin/{domain}/status": {
        get: {
          summary: "Domain forecast admin status",
          description: "Returns run status, last completed run, last failed run, stored-row count, and current generation state for Parts, Service, Warranty, or SLA.",
          tags: ["Forecasts"],
          security: [{ bearerAuth: [] }],
          parameters: [aftersalesDomainParameter],
          responses: {
            200: { description: "Current domain forecast administration status" },
            401: { description: "Authentication required" },
            403: { description: "Permission denied" },
            404: { description: "Unsupported forecast domain" }
          }
        }
      },
      "/api/v1/forecasts/admin/{domain}/clear": {
        post: {
          summary: "Clear future domain forecast rows",
          description: "Deletes future Parts, Service, Warranty, or SLA forecast rows that do not have matching source actual months.",
          tags: ["Forecasts"],
          security: [{ bearerAuth: [] }],
          parameters: [aftersalesDomainParameter],
          responses: {
            200: { description: "Domain forecast rows cleared" },
            401: { description: "Authentication required" },
            403: { description: "Permission denied" },
            404: { description: "Unsupported forecast domain" },
            409: { description: "A regeneration run is already in progress" }
          }
        }
      },
      "/api/v1/forecasts/admin/{domain}/regenerate": {
        post: {
          summary: "Regenerate domain forecast",
          description: "Starts background regeneration for Parts, Service, Warranty, or SLA.",
          tags: ["Forecasts"],
          security: [{ bearerAuth: [] }],
          parameters: [aftersalesDomainParameter],
          requestBody: {
            required: false,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    horizon: { enum: [6, 12, 24], type: "integer" }
                  }
                }
              }
            }
          },
          responses: {
            202: { description: "Domain forecast regeneration started" },
            400: { description: "Invalid horizon" },
            401: { description: "Authentication required" },
            403: { description: "Permission denied" },
            404: { description: "Unsupported forecast domain" },
            409: { description: "A regeneration run is already in progress" }
          }
        }
      },
      "/api/v1/forecasts/admin/events": {
        get: {
          summary: "List forecast events",
          description: "Returns configured forecast event calendar entries for the forecast domains the user can manage.",
          tags: ["Forecasts"],
          security: [{ bearerAuth: [] }],
          responses: {
            200: {
              description: "Forecast events",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      ok: { type: "boolean" },
                      events: {
                        type: "array",
                        items: forecastEventSchema
                      }
                    }
                  }
                }
              }
            },
            401: { description: "Authentication required" },
            403: { description: "Permission denied" }
          }
        },
        post: {
          summary: "Create forecast event",
          description: "Creates a dated event calendar entry. Regenerate forecasts or wait for the worker run before forecast outputs reflect the change.",
          tags: ["Forecasts"],
          security: [{ bearerAuth: [] }],
          requestBody: buildJsonRequestBody(forecastEventRequestSchema, {
            event_code: "DIWALI_2026",
            forecast_domain: "Sales",
            event_name: "Diwali",
            event_type: "Festive",
            scope: "National",
            scope_value: null,
            start_date: "2026-11-08",
            end_date: "2026-11-15",
            uplift_pct: 12.5,
            is_active: true
          }),
          responses: {
            201: { description: "Forecast event created" },
            400: { description: "Invalid event payload" },
            401: { description: "Authentication required" },
            403: { description: "Permission denied" },
            409: { description: "Duplicate event code" }
          }
        }
      },
      "/api/v1/forecasts/admin/events/{eventId}": {
        put: {
          summary: "Update forecast event",
          description: "Updates a dated event calendar entry. Regenerate forecasts or wait for the worker run before forecast outputs reflect the change.",
          tags: ["Forecasts"],
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              in: "path",
              name: "eventId",
              required: true,
              schema: { type: "integer" }
            }
          ],
          requestBody: buildJsonRequestBody(forecastEventRequestSchema),
          responses: {
            200: { description: "Forecast event updated" },
            400: { description: "Invalid event payload" },
            401: { description: "Authentication required" },
            403: { description: "Permission denied" },
            404: { description: "Forecast event not found" },
            409: { description: "Duplicate event code" }
          }
        },
        delete: {
          summary: "Delete forecast event",
          description: "Deletes a forecast event. Regenerate forecasts or wait for the worker run before forecast outputs reflect the change.",
          tags: ["Forecasts"],
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              in: "path",
              name: "eventId",
              required: true,
              schema: { type: "integer" }
            }
          ],
          responses: {
            200: { description: "Forecast event deleted" },
            401: { description: "Authentication required" },
            403: { description: "Permission denied" },
            404: { description: "Forecast event not found" }
          }
        }
      }
    }
  };
}

export function buildSwaggerHtml(specPath = "/api/v1/openapi.json") {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Prism Forecast API Docs</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
    <style>
      body { margin: 0; background: #f6f7f8; }
      #swagger-ui { max-width: 1200px; margin: 0 auto; }
    </style>
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
    <script>
      window.ui = SwaggerUIBundle({
        url: "${specPath}",
        dom_id: "#swagger-ui",
        deepLinking: true,
        presets: [SwaggerUIBundle.presets.apis]
      });
    </script>
  </body>
</html>`;
}
