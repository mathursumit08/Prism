BEGIN;

ALTER TABLE forecast_runs
  DROP CONSTRAINT IF EXISTS forecast_runs_domain_allowed;

UPDATE forecast_runs
SET forecast_domain = CASE LOWER(forecast_domain)
  WHEN 'sales' THEN 'Sales'
  WHEN 'parts' THEN 'Parts'
  WHEN 'service' THEN 'Service'
  ELSE forecast_domain
END;

ALTER TABLE forecast_runs
  ALTER COLUMN forecast_domain SET DEFAULT 'Sales',
  ADD CONSTRAINT forecast_runs_domain_allowed
    CHECK (forecast_domain IN ('Sales', 'Parts', 'Service'));

ALTER TABLE forecast_event_calendar
  ADD COLUMN IF NOT EXISTS forecast_domain VARCHAR(20) NOT NULL DEFAULT 'Sales';

ALTER TABLE forecast_event_calendar
  ALTER COLUMN scope TYPE VARCHAR(20);

UPDATE forecast_event_calendar
SET forecast_domain = CASE LOWER(forecast_domain)
  WHEN 'sales' THEN 'Sales'
  WHEN 'parts' THEN 'Parts'
  WHEN 'service' THEN 'Service'
  ELSE 'Sales'
END;

ALTER TABLE forecast_event_calendar
  DROP CONSTRAINT IF EXISTS forecast_event_calendar_forecast_type_event_code_key,
  DROP CONSTRAINT IF EXISTS forecast_event_calendar_forecast_domain_forecast_type_event_code_key,
  DROP CONSTRAINT IF EXISTS forecast_event_calendar_domain_type_code_key,
  DROP CONSTRAINT IF EXISTS forecast_event_calendar_domain_check,
  DROP CONSTRAINT IF EXISTS forecast_event_calendar_scope_check,
  DROP CONSTRAINT IF EXISTS forecast_event_calendar_scope_value_check;

ALTER TABLE forecast_event_calendar
  ADD CONSTRAINT forecast_event_calendar_domain_check
    CHECK (forecast_domain IN ('Sales', 'Parts', 'Service')),
  ADD CONSTRAINT forecast_event_calendar_scope_check
    CHECK (scope IN ('National', 'Zone', 'State', 'Service Center')),
  ADD CONSTRAINT forecast_event_calendar_scope_value_check CHECK (
    (scope = 'National' AND scope_value IS NULL)
    OR (scope <> 'National' AND scope_value IS NOT NULL AND LENGTH(TRIM(scope_value)) > 0)
  ),
  ADD CONSTRAINT forecast_event_calendar_domain_type_code_key
    UNIQUE (forecast_domain, forecast_type, event_code);

CREATE INDEX IF NOT EXISTS idx_forecast_event_calendar_domain_active
  ON forecast_event_calendar (forecast_domain, forecast_type, is_active);

CREATE INDEX IF NOT EXISTS idx_forecast_event_calendar_domain_dates
  ON forecast_event_calendar (forecast_domain, forecast_type, start_date, end_date);

COMMIT;
