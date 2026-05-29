BEGIN;

ALTER TABLE forecast_runs
  DROP CONSTRAINT IF EXISTS forecast_runs_domain_allowed;

ALTER TABLE forecast_runs
  ADD CONSTRAINT forecast_runs_domain_allowed
    CHECK (forecast_domain IN ('Sales', 'Parts', 'Service', 'Warranty', 'SLA'));

ALTER TABLE forecast_event_calendar
  DROP CONSTRAINT IF EXISTS forecast_event_calendar_domain_check,
  DROP CONSTRAINT IF EXISTS forecast_event_calendar_domain_type_code_key,
  DROP CONSTRAINT IF EXISTS forecast_event_calendar_forecast_domain_forecast_type_event_code_key;

ALTER TABLE forecast_event_calendar
  ADD CONSTRAINT forecast_event_calendar_domain_check
    CHECK (forecast_domain IN ('Sales', 'Parts', 'Service', 'Warranty', 'SLA')),
  ADD CONSTRAINT forecast_event_calendar_domain_type_code_key
    UNIQUE (forecast_domain, forecast_type, event_code);

ALTER TABLE user_access_scopes
  DROP CONSTRAINT IF EXISTS user_access_scopes_domain_check;

ALTER TABLE user_access_scopes
  ADD CONSTRAINT user_access_scopes_domain_check
    CHECK (domain IN ('Sales', 'Parts', 'Service', 'Warranty', 'SLA'));

ALTER TABLE forecast_dashboard_cards
  DROP CONSTRAINT IF EXISTS forecast_dashboard_cards_forecast_domain_check;

ALTER TABLE forecast_dashboard_cards
  ADD CONSTRAINT forecast_dashboard_cards_forecast_domain_check
    CHECK (forecast_domain IN ('Sales', 'Parts', 'Service', 'Warranty', 'SLA'));

CREATE TABLE IF NOT EXISTS monthly_sla_performance (
  sla_performance_id BIGSERIAL PRIMARY KEY,
  month DATE NOT NULL,
  service_center_id VARCHAR(16) NOT NULL REFERENCES service_centers(service_center_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  service_type VARCHAR(80) NOT NULL,
  job_category VARCHAR(80),
  model_id VARCHAR(16) REFERENCES vehicle_models(model_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  variant_id VARCHAR(16) REFERENCES vehicle_variants(variant_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  total_orders INTEGER NOT NULL CHECK (total_orders >= 0),
  completed_orders INTEGER NOT NULL DEFAULT 0 CHECK (completed_orders >= 0),
  breached_orders INTEGER NOT NULL DEFAULT 0 CHECK (breached_orders >= 0),
  sla_target_hours NUMERIC(8, 2) NOT NULL DEFAULT 48 CHECK (sla_target_hours > 0),
  avg_resolution_hours NUMERIC(8, 2) CHECK (avg_resolution_hours >= 0),
  p90_resolution_hours NUMERIC(8, 2) CHECK (p90_resolution_hours >= 0),
  backlog_open_orders INTEGER NOT NULL DEFAULT 0 CHECK (backlog_open_orders >= 0),
  parts_wait_orders INTEGER NOT NULL DEFAULT 0 CHECK (parts_wait_orders >= 0),
  repeat_repair_orders INTEGER NOT NULL DEFAULT 0 CHECK (repeat_repair_orders >= 0),
  cancelled_orders INTEGER NOT NULL DEFAULT 0 CHECK (cancelled_orders >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT monthly_sla_performance_completed_limit CHECK (completed_orders <= total_orders),
  CONSTRAINT monthly_sla_performance_breached_limit CHECK (breached_orders <= total_orders)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_monthly_sla_performance_unique
  ON monthly_sla_performance (month, service_center_id, service_type, job_category, model_id, variant_id) NULLS NOT DISTINCT;

CREATE INDEX IF NOT EXISTS idx_monthly_sla_performance_month
  ON monthly_sla_performance(month);

CREATE INDEX IF NOT EXISTS idx_monthly_sla_performance_center
  ON monthly_sla_performance(service_center_id);

CREATE INDEX IF NOT EXISTS idx_monthly_sla_performance_type
  ON monthly_sla_performance(service_type, job_category);

CREATE TABLE IF NOT EXISTS sla_forecast_data (
  forecast_id BIGSERIAL PRIMARY KEY,
  run_id BIGINT NOT NULL REFERENCES forecast_runs(run_id) ON DELETE CASCADE,
  forecast_type VARCHAR(32) NOT NULL,
  level VARCHAR(16) NOT NULL CHECK (level IN ('service_center', 'state', 'zone')),
  group_id VARCHAR(120) NOT NULL,
  group_label VARCHAR(160) NOT NULL,
  service_type VARCHAR(80),
  job_category VARCHAR(80),
  model_id VARCHAR(16) REFERENCES vehicle_models(model_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  variant_id VARCHAR(16) REFERENCES vehicle_variants(variant_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  forecast_month DATE NOT NULL,
  forecast_units INTEGER NOT NULL CHECK (forecast_units >= 0),
  expected_breaches INTEGER NOT NULL DEFAULT 0 CHECK (expected_breaches >= 0),
  breach_probability NUMERIC(6, 4) CHECK (breach_probability >= 0 AND breach_probability <= 1),
  risk_score NUMERIC(6, 2) CHECK (risk_score >= 0 AND risk_score <= 100),
  risk_level VARCHAR(16) NOT NULL DEFAULT 'Low' CHECK (risk_level IN ('Low', 'Medium', 'High', 'Critical')),
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
  CONSTRAINT sla_forecast_data_80_interval_order CHECK (lower_80 <= forecast_units AND forecast_units <= upper_80),
  CONSTRAINT sla_forecast_data_95_interval_order CHECK (lower_95 <= lower_80 AND upper_80 <= upper_95)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sla_forecast_data_refresh_unique
  ON sla_forecast_data (forecast_type, level, group_id, service_type, job_category, model_id, variant_id, forecast_month) NULLS NOT DISTINCT;

CREATE INDEX IF NOT EXISTS idx_sla_forecast_data_run_id
  ON sla_forecast_data(run_id);

CREATE INDEX IF NOT EXISTS idx_sla_forecast_data_run_level_month
  ON sla_forecast_data (run_id, forecast_type, level, group_id, forecast_month);

INSERT INTO monthly_sla_performance (
  month,
  service_center_id,
  service_type,
  job_category,
  model_id,
  variant_id,
  total_orders,
  completed_orders,
  breached_orders,
  sla_target_hours,
  avg_resolution_hours,
  p90_resolution_hours,
  backlog_open_orders,
  parts_wait_orders,
  repeat_repair_orders,
  cancelled_orders
)
SELECT
  mov.month,
  mov.service_center_id,
  mov.service_type,
  mov.job_category,
  NULL::VARCHAR AS model_id,
  NULL::VARCHAR AS variant_id,
  SUM(mov.order_count)::INTEGER AS total_orders,
  SUM(mov.completed_count)::INTEGER AS completed_orders,
  LEAST(
    SUM(mov.order_count)::INTEGER,
    GREATEST(
      0,
      ROUND(
        SUM(mov.order_count) * (
          0.045
          + CASE WHEN mov.service_type ILIKE '%Repair%' THEN 0.035 ELSE 0 END
          + CASE WHEN mov.job_category ILIKE '%Engine%' OR mov.job_category ILIKE '%Electrical%' THEN 0.03 ELSE 0 END
          + CASE WHEN mov.job_category ILIKE '%Body%' THEN 0.02 ELSE 0 END
          + (SUM(mov.repeat_repair_count)::NUMERIC / NULLIF(SUM(mov.order_count), 0)) * 0.30
        )
      )::INTEGER
    )
  ) AS breached_orders,
  CASE
    WHEN mov.service_type ILIKE '%Express%' THEN 24
    WHEN mov.job_category ILIKE '%Body%' THEN 96
    WHEN mov.job_category ILIKE '%Engine%' OR mov.job_category ILIKE '%Electrical%' THEN 72
    ELSE 48
  END::NUMERIC AS sla_target_hours,
  ROUND(
    CASE
      WHEN mov.service_type ILIKE '%Express%' THEN 18
      WHEN mov.job_category ILIKE '%Body%' THEN 80
      WHEN mov.job_category ILIKE '%Engine%' OR mov.job_category ILIKE '%Electrical%' THEN 58
      ELSE 36
    END
    + (SUM(mov.order_count)::NUMERIC / NULLIF(MAX(sc.service_capacity_per_day) * GREATEST(MAX(mov.working_days), 1), 0)) * 16,
    2
  ) AS avg_resolution_hours,
  ROUND(
    CASE
      WHEN mov.service_type ILIKE '%Express%' THEN 30
      WHEN mov.job_category ILIKE '%Body%' THEN 122
      WHEN mov.job_category ILIKE '%Engine%' OR mov.job_category ILIKE '%Electrical%' THEN 96
      ELSE 64
    END
    + (SUM(mov.order_count)::NUMERIC / NULLIF(MAX(sc.service_capacity_per_day) * GREATEST(MAX(mov.working_days), 1), 0)) * 24,
    2
  ) AS p90_resolution_hours,
  GREATEST(0, SUM(mov.order_count - mov.completed_count - mov.cancelled_count))::INTEGER AS backlog_open_orders,
  ROUND(SUM(mov.order_count) * CASE WHEN mov.job_category ILIKE '%Engine%' OR mov.job_category ILIKE '%Electrical%' THEN 0.12 ELSE 0.06 END)::INTEGER AS parts_wait_orders,
  SUM(mov.repeat_repair_count)::INTEGER AS repeat_repair_orders,
  SUM(mov.cancelled_count)::INTEGER AS cancelled_orders
FROM monthly_service_order_volume mov
JOIN service_centers sc ON sc.service_center_id = mov.service_center_id
GROUP BY mov.month, mov.service_center_id, mov.service_type, mov.job_category
ON CONFLICT (month, service_center_id, service_type, job_category, model_id, variant_id)
DO UPDATE SET
  total_orders = EXCLUDED.total_orders,
  completed_orders = EXCLUDED.completed_orders,
  breached_orders = EXCLUDED.breached_orders,
  sla_target_hours = EXCLUDED.sla_target_hours,
  avg_resolution_hours = EXCLUDED.avg_resolution_hours,
  p90_resolution_hours = EXCLUDED.p90_resolution_hours,
  backlog_open_orders = EXCLUDED.backlog_open_orders,
  parts_wait_orders = EXCLUDED.parts_wait_orders,
  repeat_repair_orders = EXCLUDED.repeat_repair_orders,
  cancelled_orders = EXCLUDED.cancelled_orders;

INSERT INTO permissions (permission_name)
VALUES
  ('View SLA Forecast'),
  ('Manage SLA Forecast')
ON CONFLICT (permission_name) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM roles r
JOIN permissions p ON p.permission_name = 'View SLA Forecast'
WHERE r.role_name IN ('Admin', 'National Head', 'Regional Head', 'Service Manager')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM roles r
JOIN permissions p ON p.permission_name = 'Manage SLA Forecast'
WHERE r.role_name = 'Admin'
ON CONFLICT DO NOTHING;

INSERT INTO user_access_scopes (username, domain, scope_type, scope_value)
SELECT username, 'SLA', scope_type, scope_value
FROM user_access_scopes
WHERE domain = 'Service'
ON CONFLICT (username, domain, scope_type, scope_value) DO NOTHING;

INSERT INTO forecast_dashboard_cards (forecast_domain, card_key, card_label, category, display_order, is_enabled)
VALUES
  ('SLA', 'mttr', 'MTTR', 'KPIs', 0, TRUE),
  ('SLA', 'serviceCostActualVsForecast', 'Service Cost Actuals vs Forecast', 'KPIs', 0, TRUE),
  ('SLA', 'trend', 'Trend - Actual vs Forecast trend', 'Graphs', 1, TRUE),
  ('SLA', 'segmentSplit', 'Segment split - Forecast by service segment', 'Graphs', 2, TRUE),
  ('SLA', 'accuracyTrend', 'Accuracy - MAPE / MAE / RMSE trend', 'Graphs', 3, TRUE),
  ('SLA', 'biasTrend', 'Bias - Forecast bias by month', 'Graphs', 4, TRUE),
  ('SLA', 'actualPredicted', 'Calibration - Actual vs predicted', 'Graphs', 5, TRUE),
  ('SLA', 'errorDistribution', 'Error spread - Error distribution', 'Graphs', 6, TRUE),
  ('SLA', 'leaderboard', 'Leaderboard - Accuracy leaderboard', 'Graphs', 7, TRUE),
  ('SLA', 'forecastGraph', 'Forecast graph - Monthly expected SLA breaches', 'Graphs', 8, TRUE),
  ('SLA', 'regionalSegmentSplit', 'Regional segment split - SLA risk within', 'Graphs', 9, TRUE),
  ('SLA', 'segmentBreakdown', 'Segment breakdown', 'Tables', 10, TRUE),
  ('SLA', 'forecastData', 'Forecast data', 'Tables', 11, TRUE)
ON CONFLICT (forecast_domain, card_key) DO UPDATE SET
  card_label = EXCLUDED.card_label,
  category = EXCLUDED.category,
  display_order = EXCLUDED.display_order;

COMMIT;
