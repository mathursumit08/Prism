import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { pool } from "./db.js";
import forecastRoutes from "./routes/forecastRoutes.js";
import referenceRoutes from "./routes/referenceRoutes.js";

dotenv.config();

const app = express();
const port = process.env.PORT || 4000;
const clientOrigin = process.env.CLIENT_ORIGIN || "http://localhost:5173";
const allowedOrigins = new Set([clientOrigin, "http://localhost:5173", "http://127.0.0.1:5173"]);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.has(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error(`Origin ${origin} is not allowed by CORS`));
    }
  })
);
app.use(express.json());
app.use("/api/forecasts", forecastRoutes);
app.use("/api", referenceRoutes);

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

app.listen(port, () => {
  console.log(`API listening on http://localhost:${port}`);
});
