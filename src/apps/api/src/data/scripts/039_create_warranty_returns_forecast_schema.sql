BEGIN;

ALTER TABLE forecast_runs
  DROP CONSTRAINT IF EXISTS forecast_runs_domain_allowed;

ALTER TABLE forecast_runs
  ADD CONSTRAINT forecast_runs_domain_allowed
    CHECK (forecast_domain IN ('Sales', 'Parts', 'Service', 'Warranty'));

ALTER TABLE forecast_event_calendar
  DROP CONSTRAINT IF EXISTS forecast_event_calendar_domain_check,
  DROP CONSTRAINT IF EXISTS forecast_event_calendar_domain_type_code_key,
  DROP CONSTRAINT IF EXISTS forecast_event_calendar_forecast_domain_forecast_type_event_code_key;

ALTER TABLE forecast_event_calendar
  ADD CONSTRAINT forecast_event_calendar_domain_check
    CHECK (forecast_domain IN ('Sales', 'Parts', 'Service', 'Warranty')),
  ADD CONSTRAINT forecast_event_calendar_domain_type_code_key
    UNIQUE (forecast_domain, forecast_type, event_code);

ALTER TABLE user_access_scopes
  DROP CONSTRAINT IF EXISTS user_access_scopes_domain_check;

ALTER TABLE user_access_scopes
  ADD CONSTRAINT user_access_scopes_domain_check
    CHECK (domain IN ('Sales', 'Parts', 'Service', 'Warranty'));

ALTER TABLE forecast_dashboard_cards
  DROP CONSTRAINT IF EXISTS forecast_dashboard_cards_forecast_domain_check;

ALTER TABLE forecast_dashboard_cards
  ADD CONSTRAINT forecast_dashboard_cards_forecast_domain_check
    CHECK (forecast_domain IN ('Sales', 'Parts', 'Service', 'Warranty'));

CREATE TABLE IF NOT EXISTS warranty_claims (
  claim_id VARCHAR(32) PRIMARY KEY,
  claim_date DATE NOT NULL,
  month DATE NOT NULL,
  service_center_id VARCHAR(16) NOT NULL REFERENCES service_centers(service_center_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  model_id VARCHAR(16) REFERENCES vehicle_models(model_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  variant_id VARCHAR(16) REFERENCES vehicle_variants(variant_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  claim_type VARCHAR(80) NOT NULL,
  claim_category VARCHAR(80) NOT NULL,
  age_bucket VARCHAR(24) NOT NULL,
  vehicle_age_months INTEGER NOT NULL CHECK (vehicle_age_months >= 0),
  claim_count INTEGER NOT NULL DEFAULT 1 CHECK (claim_count >= 0),
  claim_amount NUMERIC(12, 2) NOT NULL CHECK (claim_amount >= 0),
  status VARCHAR(40) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS product_returns (
  return_id VARCHAR(32) PRIMARY KEY,
  return_date DATE NOT NULL,
  month DATE NOT NULL,
  service_center_id VARCHAR(16) NOT NULL REFERENCES service_centers(service_center_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  model_id VARCHAR(16) REFERENCES vehicle_models(model_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  variant_id VARCHAR(16) REFERENCES vehicle_variants(variant_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  return_reason VARCHAR(80) NOT NULL,
  age_bucket VARCHAR(24) NOT NULL,
  vehicle_age_months INTEGER NOT NULL CHECK (vehicle_age_months >= 0),
  return_count INTEGER NOT NULL DEFAULT 1 CHECK (return_count >= 0),
  return_amount NUMERIC(12, 2) NOT NULL CHECK (return_amount >= 0),
  status VARCHAR(40) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS monthly_warranty_return_volume (
  volume_id BIGSERIAL PRIMARY KEY,
  month DATE NOT NULL,
  service_center_id VARCHAR(16) NOT NULL REFERENCES service_centers(service_center_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  claim_type VARCHAR(80) NOT NULL,
  return_reason VARCHAR(80) NOT NULL,
  age_bucket VARCHAR(24) NOT NULL,
  model_id VARCHAR(16) REFERENCES vehicle_models(model_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  variant_id VARCHAR(16) REFERENCES vehicle_variants(variant_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  claim_count INTEGER NOT NULL DEFAULT 0 CHECK (claim_count >= 0),
  return_count INTEGER NOT NULL DEFAULT 0 CHECK (return_count >= 0),
  claim_amount NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (claim_amount >= 0),
  return_amount NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (return_amount >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_monthly_warranty_return_volume_unique
  ON monthly_warranty_return_volume (month, service_center_id, claim_type, return_reason, age_bucket, model_id, variant_id) NULLS NOT DISTINCT;

CREATE TABLE IF NOT EXISTS warranty_forecast_data (
  forecast_id BIGSERIAL PRIMARY KEY,
  run_id BIGINT NOT NULL REFERENCES forecast_runs(run_id) ON DELETE CASCADE,
  forecast_type VARCHAR(32) NOT NULL,
  level VARCHAR(16) NOT NULL CHECK (level IN ('service_center', 'state', 'zone')),
  group_id VARCHAR(120) NOT NULL,
  group_label VARCHAR(160) NOT NULL,
  claim_type VARCHAR(80),
  return_reason VARCHAR(80),
  age_bucket VARCHAR(24),
  model_id VARCHAR(16) REFERENCES vehicle_models(model_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  variant_id VARCHAR(16) REFERENCES vehicle_variants(variant_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  forecast_month DATE NOT NULL,
  forecast_units INTEGER NOT NULL CHECK (forecast_units >= 0),
  lower_80 INTEGER NOT NULL CHECK (lower_80 >= 0),
  upper_80 INTEGER NOT NULL CHECK (upper_80 >= 0),
  lower_95 INTEGER NOT NULL CHECK (lower_95 >= 0),
  upper_95 INTEGER NOT NULL CHECK (upper_95 >= 0),
  model_method VARCHAR(120) NOT NULL,
  validation_mae NUMERIC(12, 2),
  validation_rmse NUMERIC(12, 2),
  validation_mape NUMERIC(12, 2),
  data_quality VARCHAR(16) NOT NULL DEFAULT 'rich' CHECK (data_quality IN ('rich', 'sparse', 'fallback')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT warranty_forecast_data_80_interval_order CHECK (lower_80 <= forecast_units AND forecast_units <= upper_80),
  CONSTRAINT warranty_forecast_data_95_interval_order CHECK (lower_95 <= lower_80 AND upper_80 <= upper_95)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_warranty_forecast_data_refresh_unique
  ON warranty_forecast_data (forecast_type, level, group_id, claim_type, return_reason, age_bucket, model_id, variant_id, forecast_month) NULLS NOT DISTINCT;

CREATE INDEX IF NOT EXISTS idx_warranty_claims_month ON warranty_claims(month);
CREATE INDEX IF NOT EXISTS idx_product_returns_month ON product_returns(month);
CREATE INDEX IF NOT EXISTS idx_monthly_warranty_return_month ON monthly_warranty_return_volume(month);
CREATE INDEX IF NOT EXISTS idx_monthly_warranty_return_center ON monthly_warranty_return_volume(service_center_id);

INSERT INTO permissions (permission_name)
VALUES
  ('View Warranty Forecast'),
  ('Manage Warranty Forecast')
ON CONFLICT (permission_name) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM roles r
JOIN permissions p ON p.permission_name = 'View Warranty Forecast'
WHERE r.role_name IN ('Admin', 'National Head', 'Regional Head')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM roles r
JOIN permissions p ON p.permission_name = 'Manage Warranty Forecast'
WHERE r.role_name = 'Admin'
ON CONFLICT DO NOTHING;

INSERT INTO user_access_scopes (username, domain, scope_type, scope_value)
SELECT username, 'Warranty', scope_type, scope_value
FROM user_access_scopes
WHERE domain = 'Sales'
  AND scope_type IN ('National', 'Region')
ON CONFLICT (username, domain, scope_type, scope_value) DO NOTHING;

INSERT INTO forecast_dashboard_cards (forecast_domain, card_key, card_label, category, display_order, is_enabled)
VALUES
  ('Warranty', 'trend', 'Trend - Actual vs Forecast trend', 'Graphs', 1, TRUE),
  ('Warranty', 'segmentSplit', 'Segment split - Forecast by claim and return segment', 'Graphs', 2, TRUE),
  ('Warranty', 'accuracyTrend', 'Accuracy - MAPE / MAE / RMSE trend', 'Graphs', 3, TRUE),
  ('Warranty', 'biasTrend', 'Bias - Forecast bias by month', 'Graphs', 4, TRUE),
  ('Warranty', 'actualPredicted', 'Calibration - Actual vs predicted', 'Graphs', 5, TRUE),
  ('Warranty', 'errorDistribution', 'Error spread - Error distribution', 'Graphs', 6, TRUE),
  ('Warranty', 'leaderboard', 'Leaderboard - Accuracy leaderboard', 'Graphs', 7, TRUE),
  ('Warranty', 'forecastGraph', 'Forecast graph - Monthly claims and returns', 'Graphs', 8, TRUE),
  ('Warranty', 'regionalSegmentSplit', 'Regional segment split - Warranty and returns within', 'Graphs', 9, TRUE),
  ('Warranty', 'segmentBreakdown', 'Segment breakdown', 'Tables', 10, TRUE),
  ('Warranty', 'forecastData', 'Forecast data', 'Tables', 11, TRUE)
ON CONFLICT (forecast_domain, card_key) DO UPDATE SET
  card_label = EXCLUDED.card_label,
  category = EXCLUDED.category,
  display_order = EXCLUDED.display_order;

COMMIT;
