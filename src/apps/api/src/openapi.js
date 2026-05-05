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
    category: { enum: ["Graphs", "Tables"], type: "string" },
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
    forecastType: { type: "string" },
    eventCode: { type: "string" },
    eventName: { type: "string" },
    eventType: { enum: ["festive", "regulatory", "promotional", "holiday", "other"], type: "string" },
    scope: { enum: ["national", "zone", "state"], type: "string" },
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
  required: ["event_code", "event_name", "event_type", "scope", "start_date", "end_date", "uplift_pct"],
  properties: {
    event_code: { type: "string" },
    event_name: { type: "string" },
    event_type: { enum: ["festive", "regulatory", "promotional", "holiday", "other"], type: "string" },
    scope: { enum: ["national", "zone", "state"], type: "string" },
    scope_value: { nullable: true, type: "string" },
    start_date: { format: "date", type: "string" },
    end_date: { format: "date", type: "string" },
    uplift_pct: { minimum: -100, maximum: 200, type: "number" },
    is_active: { default: true, type: "boolean" }
  }
};

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
    tags: [{ name: "Auth" }, { name: "Forecasts" }],
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
      "/api/auth/login": {
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
      "/api/auth/refresh": {
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
      "/api/auth/logout": {
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
      "/api/auth/me": {
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
          description: "Returns the global card visibility settings used by the forecast dashboard.",
          tags: ["Forecasts"],
          security: [{ bearerAuth: [] }],
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
                        required: ["key", "enabled"],
                        properties: {
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
      "/api/v1/forecasts/admin/events": {
        get: {
          summary: "List forecast events",
          description: "Returns configured sales-impacting event calendar entries.",
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
            event_name: "Diwali",
            event_type: "festive",
            scope: "national",
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
