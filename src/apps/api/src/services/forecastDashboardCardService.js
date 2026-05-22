import { pool } from "../db.js";

export const dashboardCardDomains = ["Sales", "Parts", "Service"];

const baseCards = [
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

const domainLabelOverrides = {
  Parts: {
    segmentSplit: "Segment split - Forecast by part category",
    regionalSegmentSplit: "Regional segment split - Part categories within"
  },
  Service: {
    segmentSplit: "Segment split - Forecast by service segment",
    forecastGraph: "Forecast graph - Monthly orders",
    regionalSegmentSplit: "Regional segment split - Service segments within"
  }
};

export const dashboardCards = dashboardCardDomains.flatMap((domain) =>
  baseCards.map((card) => ({
    ...card,
    domain,
    label: domainLabelOverrides[domain]?.[card.key] || card.label
  }))
);

const dashboardCardKeys = new Set(baseCards.map((card) => card.key));
const dashboardDomainSet = new Set(dashboardCardDomains);

function normalizeDomain(value) {
  if (!value) {
    return null;
  }

  const normalized = String(value).trim().toLowerCase();
  const match = dashboardCardDomains.find((domain) => domain.toLowerCase() === normalized);
  return match || null;
}

function getDefinition(domain, key) {
  return dashboardCards.find((card) => card.domain === domain && card.key === key);
}

function normalizeRow(row) {
  const domain = normalizeDomain(row.forecast_domain) || "Sales";
  const definition = getDefinition(domain, row.card_key);

  return {
    domain,
    key: row.card_key,
    label: definition?.label || row.card_label || row.card_key,
    category: definition?.category || row.category || "Graphs",
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
    const offset = index * 5;
    values.push(card.domain, card.key, card.label, card.category, card.displayOrder);
    return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, TRUE)`;
  });

  await db.query(
    `
      INSERT INTO forecast_dashboard_cards (forecast_domain, card_key, card_label, category, display_order, is_enabled)
      VALUES ${placeholders.join(", ")}
      ON CONFLICT (forecast_domain, card_key) DO UPDATE SET
        card_label = EXCLUDED.card_label,
        category = EXCLUDED.category,
        display_order = EXCLUDED.display_order
    `,
    values
  );
}

export const ForecastDashboardCardService = {
  normalizeDomain,

  async findAll({ domain } = {}, db = pool) {
    await ensureDefaultRows(db);
    const normalizedDomain = normalizeDomain(domain);
    const values = [];
    const conditions = [];

    if (domain && !normalizedDomain) {
      throw createHttpError(400, `Unsupported dashboard card domain "${domain}"`);
    }

    if (normalizedDomain) {
      values.push(normalizedDomain);
      conditions.push(`forecast_domain = $${values.length}`);
    }

    const result = await db.query(
      `
        SELECT forecast_domain, card_key, card_label, category, display_order, is_enabled, updated_at
        FROM forecast_dashboard_cards
        ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
        ORDER BY forecast_domain, display_order, card_key
      `,
      values
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

    for (const card of cards) {
      const domain = normalizeDomain(card.domain);
      if (!domain || !dashboardDomainSet.has(domain)) {
        throw createHttpError(400, `Unsupported dashboard card domain "${card.domain}"`);
      }

      if (!dashboardCardKeys.has(card.key)) {
        throw createHttpError(400, `Unsupported dashboard card "${card.key}"`);
      }
    }

    await ensureDefaultRows(db);

    for (const card of cards) {
      await db.query(
        `
          UPDATE forecast_dashboard_cards
          SET is_enabled = $3,
              updated_at = NOW()
          WHERE forecast_domain = $1
            AND card_key = $2
        `,
        [normalizeDomain(card.domain), card.key, Boolean(card.enabled)]
      );
    }

    return this.findAll({}, db);
  }
};
