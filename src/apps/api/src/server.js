import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { pool } from "./db.js";
import referenceRoutes from "./routes/referenceRoutes.js";
import authRoutes from "./routes/authRoutes.js";
import v1ForecastRoutes from "./routes/v1/forecastRoutes.js";
import { buildOpenApiSpec, buildSwaggerHtml } from "./openapi.js";

dotenv.config();

const app = express();
const port = process.env.PORT || 4000;
const clientOrigin = process.env.CLIENT_ORIGIN || "http://localhost:5173";
const allowedOrigins = new Set([clientOrigin, "http://localhost:5173", "http://127.0.0.1:5173"]);

function parseCookies(request, _response, next) {
  const rawCookieHeader = request.headers.cookie || "";
  request.cookies = Object.fromEntries(
    rawCookieHeader
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const separatorIndex = part.indexOf("=");
        const key = separatorIndex >= 0 ? part.slice(0, separatorIndex).trim() : part;
        const value = separatorIndex >= 0 ? part.slice(separatorIndex + 1).trim() : "";
        return [key, decodeURIComponent(value)];
      })
  );
  next();
}

app.use(
  cors((request, callback) => {
    const origin = request.header("Origin");
    const forwardedProto = request.header("X-Forwarded-Proto");
    const protocol = forwardedProto || request.protocol;
    const serverOrigin = `${protocol}://${request.get("host")}`;
    const isAllowedOrigin = !origin || allowedOrigins.has(origin) || origin === serverOrigin;

    if (!isAllowedOrigin) {
      callback(new Error(`Origin ${origin} is not allowed by CORS`));
      return;
    }

    callback(null, {
      credentials: true,
      origin: true
    });
  })
);
app.use(parseCookies);
app.use(express.json());

app.get("/api/v1/openapi.json", (request, response) => {
  response.json(buildOpenApiSpec(`${request.protocol}://${request.get("host")}`));
});

app.get("/api/v1/docs", (_request, response) => {
  response.type("html").send(buildSwaggerHtml("/api/v1/openapi.json"));
});

app.get("/api/health", (_request, response) => {
  response.json({
    ok: true,
    message: "API is running",
    port
  });
});

app.get("/api/db-check", async (_request, response) => {
  try {
    const result = await pool.query("SELECT NOW() AS server_time");
    response.json({
      ok: true,
      database: "connected",
      serverTime: result.rows[0].server_time
    });
  } catch (error) {
    response.status(500).json({
      ok: false,
      database: "disconnected",
      error: error.message
    });
  }
});

app.use("/api/auth", authRoutes);
app.use("/api/v1/forecasts", v1ForecastRoutes);
app.use("/api", referenceRoutes);

app.listen(port, () => {
  console.log(`API listening on http://localhost:${port}`);
});
