BEGIN;

ALTER TABLE forecast_dashboard_cards
  ADD COLUMN IF NOT EXISTS forecast_domain VARCHAR(20) NOT NULL DEFAULT 'Sales';

ALTER TABLE forecast_dashboard_cards
  DROP CONSTRAINT IF EXISTS forecast_dashboard_cards_pkey;

ALTER TABLE forecast_dashboard_cards
  DROP CONSTRAINT IF EXISTS forecast_dashboard_cards_forecast_domain_check;

ALTER TABLE forecast_dashboard_cards
  ADD CONSTRAINT forecast_dashboard_cards_forecast_domain_check
    CHECK (forecast_domain IN ('Sales', 'Parts', 'Service'));

UPDATE forecast_dashboard_cards
SET forecast_domain = 'Sales'
WHERE forecast_domain IS NULL;

ALTER TABLE forecast_dashboard_cards
  ADD CONSTRAINT forecast_dashboard_cards_pkey PRIMARY KEY (forecast_domain, card_key);

INSERT INTO forecast_dashboard_cards (forecast_domain, card_key, card_label, category, display_order, is_enabled)
VALUES
  ('Sales', 'trend', 'Trend - Actual vs Forecast trend', 'Graphs', 1, TRUE),
  ('Sales', 'segmentSplit', 'Segment split - Forecast by segment', 'Graphs', 2, TRUE),
  ('Sales', 'accuracyTrend', 'Accuracy - MAPE / MAE / RMSE trend', 'Graphs', 3, TRUE),
  ('Sales', 'biasTrend', 'Bias - Forecast bias by month', 'Graphs', 4, TRUE),
  ('Sales', 'actualPredicted', 'Calibration - Actual vs predicted', 'Graphs', 5, TRUE),
  ('Sales', 'errorDistribution', 'Error spread - Error distribution', 'Graphs', 6, TRUE),
  ('Sales', 'leaderboard', 'Leaderboard - Accuracy leaderboard', 'Graphs', 7, TRUE),
  ('Sales', 'forecastGraph', 'Forecast graph - Monthly units', 'Graphs', 8, TRUE),
  ('Sales', 'regionalSegmentSplit', 'Regional segment split - Segments within', 'Graphs', 9, TRUE),
  ('Sales', 'segmentBreakdown', 'Segment breakdown', 'Tables', 10, TRUE),
  ('Sales', 'forecastData', 'Forecast data', 'Tables', 11, TRUE),
  ('Parts', 'trend', 'Trend - Actual vs Forecast trend', 'Graphs', 1, TRUE),
  ('Parts', 'segmentSplit', 'Segment split - Forecast by part category', 'Graphs', 2, TRUE),
  ('Parts', 'accuracyTrend', 'Accuracy - MAPE / MAE / RMSE trend', 'Graphs', 3, TRUE),
  ('Parts', 'biasTrend', 'Bias - Forecast bias by month', 'Graphs', 4, TRUE),
  ('Parts', 'actualPredicted', 'Calibration - Actual vs predicted', 'Graphs', 5, TRUE),
  ('Parts', 'errorDistribution', 'Error spread - Error distribution', 'Graphs', 6, TRUE),
  ('Parts', 'leaderboard', 'Leaderboard - Accuracy leaderboard', 'Graphs', 7, TRUE),
  ('Parts', 'forecastGraph', 'Forecast graph - Monthly units', 'Graphs', 8, TRUE),
  ('Parts', 'regionalSegmentSplit', 'Regional segment split - Part categories within', 'Graphs', 9, TRUE),
  ('Parts', 'segmentBreakdown', 'Segment breakdown', 'Tables', 10, TRUE),
  ('Parts', 'forecastData', 'Forecast data', 'Tables', 11, TRUE),
  ('Service', 'trend', 'Trend - Actual vs Forecast trend', 'Graphs', 1, TRUE),
  ('Service', 'segmentSplit', 'Segment split - Forecast by service segment', 'Graphs', 2, TRUE),
  ('Service', 'accuracyTrend', 'Accuracy - MAPE / MAE / RMSE trend', 'Graphs', 3, TRUE),
  ('Service', 'biasTrend', 'Bias - Forecast bias by month', 'Graphs', 4, TRUE),
  ('Service', 'actualPredicted', 'Calibration - Actual vs predicted', 'Graphs', 5, TRUE),
  ('Service', 'errorDistribution', 'Error spread - Error distribution', 'Graphs', 6, TRUE),
  ('Service', 'leaderboard', 'Leaderboard - Accuracy leaderboard', 'Graphs', 7, TRUE),
  ('Service', 'forecastGraph', 'Forecast graph - Monthly orders', 'Graphs', 8, TRUE),
  ('Service', 'regionalSegmentSplit', 'Regional segment split - Service segments within', 'Graphs', 9, TRUE),
  ('Service', 'segmentBreakdown', 'Segment breakdown', 'Tables', 10, TRUE),
  ('Service', 'forecastData', 'Forecast data', 'Tables', 11, TRUE)
ON CONFLICT (forecast_domain, card_key) DO UPDATE SET
  card_label = EXCLUDED.card_label,
  category = EXCLUDED.category,
  display_order = EXCLUDED.display_order;

COMMIT;
