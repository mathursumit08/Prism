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
        segment: { nullable: true, type: "string" },
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
        "Returns a blended view that combines national, regional, and dealer forecast records."
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
      "/api/v1/forecasts/admin/clear": {
        post: {
          summary: "Clear forecast rows",
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
