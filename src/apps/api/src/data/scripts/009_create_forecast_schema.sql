BEGIN;

-- Stores one audit row per forecast worker execution.
CREATE TABLE IF NOT EXISTS forecast_runs (
  run_id BIGSERIAL PRIMARY KEY,
  forecast_type VARCHAR(32) NOT NULL DEFAULT 'baseline',
  status VARCHAR(24) NOT NULL DEFAULT 'running',
  horizon_months INTEGER NOT NULL CHECK (horizon_months BETWEEN 1 AND 24),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  error_message TEXT
);

-- Stores each generated monthly forecast point for dealer, state, and zone levels.
CREATE TABLE IF NOT EXISTS forecast_data (
  forecast_id BIGSERIAL PRIMARY KEY,
  run_id BIGINT NOT NULL REFERENCES forecast_runs(run_id) ON DELETE CASCADE,
  forecast_type VARCHAR(32) NOT NULL DEFAULT 'baseline',
  level VARCHAR(16) NOT NULL CHECK (level IN ('dealer', 'state', 'zone')),
  group_id VARCHAR(120) NOT NULL,
  group_label VARCHAR(160) NOT NULL,
  model_id VARCHAR(16) REFERENCES vehicle_models(model_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  variant_id VARCHAR(16) REFERENCES vehicle_variants(variant_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  forecast_month DATE NOT NULL,
  forecast_units INTEGER NOT NULL CHECK (forecast_units >= 0),
  model_method VARCHAR(120) NOT NULL,
  validation_mae NUMERIC(12, 2),
  validation_rmse NUMERIC(12, 2),
  validation_mape NUMERIC(12, 2),
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Supports fast lookup of the latest completed baseline run.
CREATE INDEX IF NOT EXISTS idx_forecast_runs_latest
  ON forecast_runs (forecast_type, status, completed_at DESC);

-- Supports API filtering by hierarchy level, model, variant, and forecast month.
CREATE INDEX IF NOT EXISTS idx_forecast_data_lookup
  ON forecast_data (forecast_type, level, model_id, variant_id, forecast_month);

-- Supports joining forecast rows back to their run audit record.
CREATE INDEX IF NOT EXISTS idx_forecast_data_run_id
  ON forecast_data (run_id);

COMMIT;
