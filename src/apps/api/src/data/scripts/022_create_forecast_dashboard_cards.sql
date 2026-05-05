BEGIN;

CREATE TABLE IF NOT EXISTS forecast_dashboard_cards (
  card_key VARCHAR(80) PRIMARY KEY,
  card_label VARCHAR(160) NOT NULL,
  category VARCHAR(40) NOT NULL CHECK (category IN ('Graphs', 'Tables')),
  display_order INTEGER NOT NULL,
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO forecast_dashboard_cards (card_key, card_label, category, display_order, is_enabled)
VALUES
  ('trend', 'Trend - Actual vs Forecast trend', 'Graphs', 1, TRUE),
  ('segmentSplit', 'Segment split - Forecast by segment', 'Graphs', 2, TRUE),
  ('accuracyTrend', 'Accuracy - MAPE / MAE / RMSE trend', 'Graphs', 3, TRUE),
  ('biasTrend', 'Bias - Forecast bias by month', 'Graphs', 4, TRUE),
  ('actualPredicted', 'Calibration - Actual vs predicted', 'Graphs', 5, TRUE),
  ('errorDistribution', 'Error spread - Error distribution', 'Graphs', 6, TRUE),
  ('leaderboard', 'Leaderboard - Accuracy leaderboard', 'Graphs', 7, TRUE),
  ('forecastGraph', 'Forecast graph - Monthly units', 'Graphs', 8, TRUE),
  ('regionalSegmentSplit', 'Regional segment split - Segments within', 'Graphs', 9, TRUE),
  ('segmentBreakdown', 'Segment breakdown', 'Tables', 10, TRUE),
  ('forecastData', 'Forecast data', 'Tables', 11, TRUE)
ON CONFLICT (card_key) DO UPDATE SET
  card_label = EXCLUDED.card_label,
  category = EXCLUDED.category,
  display_order = EXCLUDED.display_order;

COMMIT;
