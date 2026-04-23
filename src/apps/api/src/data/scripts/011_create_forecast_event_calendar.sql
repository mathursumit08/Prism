BEGIN;

-- Stores configurable recurring festive-event uplift windows used by forecast refreshes.
CREATE TABLE IF NOT EXISTS forecast_event_calendar (
  event_id BIGSERIAL PRIMARY KEY,
  forecast_type VARCHAR(32) NOT NULL DEFAULT 'baseline',
  event_code VARCHAR(40) NOT NULL,
  event_name VARCHAR(120) NOT NULL,
  start_month SMALLINT NOT NULL CHECK (start_month BETWEEN 1 AND 12),
  end_month SMALLINT NOT NULL CHECK (end_month BETWEEN 1 AND 12),
  uplift_pct NUMERIC(6, 2) NOT NULL CHECK (uplift_pct >= 0),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (forecast_type, event_code)
);

-- Supports worker lookup of active uplift rules for a forecast type.
CREATE INDEX IF NOT EXISTS idx_forecast_event_calendar_active
  ON forecast_event_calendar (forecast_type, is_active);

COMMIT;
