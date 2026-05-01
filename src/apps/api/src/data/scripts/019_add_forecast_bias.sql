BEGIN;

CREATE TABLE IF NOT EXISTS forecast_bias (
  bias_id BIGSERIAL PRIMARY KEY,
  level VARCHAR(10) NOT NULL CHECK (level IN ('dealer', 'zone')),
  group_id VARCHAR(100) NOT NULL,
  window_months INTEGER NOT NULL DEFAULT 6,
  mean_error NUMERIC(10, 4),
  correction NUMERIC(10, 6) NOT NULL DEFAULT 1.0,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (level, group_id)
);

CREATE INDEX IF NOT EXISTS idx_forecast_bias_lookup
  ON forecast_bias (level, group_id);

ALTER TABLE forecast_data
  ADD COLUMN IF NOT EXISTS bias_correction NUMERIC(10, 6) NOT NULL DEFAULT 1.0;

COMMIT;
