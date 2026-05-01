BEGIN;

ALTER TABLE forecast_event_calendar
  ADD COLUMN IF NOT EXISTS start_date DATE,
  ADD COLUMN IF NOT EXISTS end_date DATE,
  ADD COLUMN IF NOT EXISTS event_type VARCHAR(20) NOT NULL DEFAULT 'festive',
  ADD COLUMN IF NOT EXISTS scope VARCHAR(10) NOT NULL DEFAULT 'national',
  ADD COLUMN IF NOT EXISTS scope_value VARCHAR(120);

UPDATE forecast_event_calendar
SET
  start_date = MAKE_DATE(2026, start_month, 1),
  end_date = (MAKE_DATE(2026, end_month, 1) + INTERVAL '1 month - 1 day')::DATE
WHERE start_date IS NULL
  AND end_date IS NULL
  AND start_month IS NOT NULL
  AND end_month IS NOT NULL;

UPDATE forecast_event_calendar
SET
  start_date = COALESCE(start_date, DATE '2026-01-01'),
  end_date = COALESCE(end_date, DATE '2026-01-31');

ALTER TABLE forecast_event_calendar
  ALTER COLUMN start_date SET NOT NULL,
  ALTER COLUMN end_date SET NOT NULL;

ALTER TABLE forecast_event_calendar
  DROP CONSTRAINT IF EXISTS forecast_event_calendar_uplift_pct_check,
  DROP CONSTRAINT IF EXISTS forecast_event_calendar_event_type_check,
  DROP CONSTRAINT IF EXISTS forecast_event_calendar_scope_check,
  DROP CONSTRAINT IF EXISTS forecast_event_calendar_date_range_check,
  DROP CONSTRAINT IF EXISTS forecast_event_calendar_scope_value_check;

ALTER TABLE forecast_event_calendar
  ADD CONSTRAINT forecast_event_calendar_uplift_pct_check CHECK (uplift_pct BETWEEN -100 AND 200),
  ADD CONSTRAINT forecast_event_calendar_event_type_check CHECK (event_type IN ('festive', 'regulatory', 'promotional', 'holiday', 'other')),
  ADD CONSTRAINT forecast_event_calendar_scope_check CHECK (scope IN ('national', 'zone', 'state')),
  ADD CONSTRAINT forecast_event_calendar_date_range_check CHECK (end_date >= start_date),
  ADD CONSTRAINT forecast_event_calendar_scope_value_check CHECK (
    (scope = 'national' AND scope_value IS NULL)
    OR (scope IN ('zone', 'state') AND scope_value IS NOT NULL AND LENGTH(TRIM(scope_value)) > 0)
  );

ALTER TABLE forecast_event_calendar
  DROP COLUMN IF EXISTS start_month,
  DROP COLUMN IF EXISTS end_month;

CREATE INDEX IF NOT EXISTS idx_forecast_event_calendar_dates
  ON forecast_event_calendar (forecast_type, start_date, end_date);

COMMIT;
