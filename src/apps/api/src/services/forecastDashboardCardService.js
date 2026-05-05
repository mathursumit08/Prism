import { pool } from "../db.js";

export const dashboardCards = [
  { key: "trend", label: "Trend - Actual vs Forecast trend", category: "Graphs", displayOrder: 1 },
  { key: "segmentSplit", label: "Segment split - Forecast by segment", category: "Graphs", displayOrder: 2 },
  { key: "accuracyTrend", label: "Accuracy - MAPE / MAE / RMSE trend", category: "Graphs", displayOrder: 3 },
  { key: "biasTrend", label: "Bias - Forecast bias by month", category: "Graphs", displayOrder: 4 },
  { key: "actualPredicted", label: "Calibration - Actual vs predicted", category: "Graphs", displayOrder: 5 },
  { key: "errorDistribution", label: "Error spread - Error distribution", category: "Graphs", displayOrder: 6 },
  { key: "leaderboard", label: "Leaderboard - Accuracy leaderboard", category: "Graphs", displayOrder: 7 },
  { key: "forecastGraph", label: "Forecast graph - Monthly units", category: "Graphs", displayOrder: 8 },
  { key: "regionalSegmentSplit", label: "Regional segment split - Segments within", category: "Graphs", displayOrder: 9 },
  { key: "segmentBreakdown", label: "Segment breakdown", category: "Tables", displayOrder: 10 },
  { key: "forecastData", label: "Forecast data", category: "Tables", displayOrder: 11 }
];

const dashboardCardKeys = new Set(dashboardCards.map((card) => card.key));

function normalizeRow(row) {
  const definition = dashboardCards.find((card) => card.key === row.card_key);

  return {
    key: row.card_key,
    label: definition?.label || row.card_key,
    category: definition?.category || "Graphs",
    displayOrder: definition?.displayOrder || Number(row.display_order || 0),
    enabled: Boolean(row.is_enabled),
    updatedAt: row.updated_at
  };
}

function createHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

async function ensureDefaultRows(db = pool) {
  const values = [];
  const placeholders = dashboardCards.map((card, index) => {
    const offset = index * 4;
    values.push(card.key, card.label, card.category, card.displayOrder);
    return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, TRUE)`;
  });

  await db.query(
    `
      INSERT INTO forecast_dashboard_cards (card_key, card_label, category, display_order, is_enabled)
      VALUES ${placeholders.join(", ")}
      ON CONFLICT (card_key) DO UPDATE SET
        card_label = EXCLUDED.card_label,
        category = EXCLUDED.category,
        display_order = EXCLUDED.display_order
    `,
    values
  );
}

export const ForecastDashboardCardService = {
  async findAll(db = pool) {
    await ensureDefaultRows(db);
    const result = await db.query(
      `
        SELECT card_key, card_label, category, display_order, is_enabled, updated_at
        FROM forecast_dashboard_cards
        ORDER BY display_order, card_key
      `
    );

    return {
      ok: true,
      cards: result.rows.map(normalizeRow)
    };
  },

  async updateCards(cards, db = pool) {
    if (!Array.isArray(cards)) {
      throw createHttpError(400, "cards must be an array");
    }

    const unknownCard = cards.find((card) => !dashboardCardKeys.has(card.key));
    if (unknownCard) {
      throw createHttpError(400, `Unsupported dashboard card "${unknownCard.key}"`);
    }

    await ensureDefaultRows(db);

    for (const card of cards) {
      await db.query(
        `
          UPDATE forecast_dashboard_cards
          SET is_enabled = $2,
              updated_at = NOW()
          WHERE card_key = $1
        `,
        [card.key, Boolean(card.enabled)]
      );
    }

    return this.findAll(db);
  }
};
