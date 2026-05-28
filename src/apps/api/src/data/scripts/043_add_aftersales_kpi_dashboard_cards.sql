BEGIN;

ALTER TABLE forecast_dashboard_cards
  DROP CONSTRAINT IF EXISTS forecast_dashboard_cards_category_check;

ALTER TABLE forecast_dashboard_cards
  ADD CONSTRAINT forecast_dashboard_cards_category_check
    CHECK (category IN ('KPIs', 'Graphs', 'Tables'));

INSERT INTO forecast_dashboard_cards (forecast_domain, card_key, card_label, category, display_order, is_enabled)
VALUES
  ('Sales', 'salesForecastAccuracy', 'Forecast Accuracy %', 'KPIs', 1, TRUE),
  ('Sales', 'salesActualsVsForecast', 'Sales Actuals vs Forecast', 'KPIs', 2, TRUE),
  ('Sales', 'salesForecastBias', 'Forecast Bias %', 'KPIs', 3, TRUE),
  ('Sales', 'inventoryCoverage', 'Inventory Coverage', 'KPIs', 4, TRUE),
  ('Parts', 'fillRate', 'Fill Rate - Parts availability vs demand', 'KPIs', 1, TRUE),
  ('Parts', 'serviceCostActualVsForecast', 'Service Cost - Actuals vs Forecast', 'KPIs', 2, TRUE),
  ('Service', 'mttr', 'MTTR - Mean time to repair', 'KPIs', 1, TRUE),
  ('Service', 'serviceCostActualVsForecast', 'Service Cost - Actuals vs Forecast', 'KPIs', 2, TRUE),
  ('Warranty', 'returnRate', 'Return Rate %', 'KPIs', 1, TRUE),
  ('Warranty', 'serviceCostActualVsForecast', 'Service Cost - Actuals vs Forecast', 'KPIs', 2, TRUE)
ON CONFLICT (forecast_domain, card_key) DO UPDATE SET
  card_label = EXCLUDED.card_label,
  category = EXCLUDED.category,
  display_order = EXCLUDED.display_order;

COMMIT;
