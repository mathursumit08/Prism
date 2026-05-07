BEGIN;

ALTER TABLE forecast_event_calendar
  DROP CONSTRAINT IF EXISTS forecast_event_calendar_event_type_check,
  DROP CONSTRAINT IF EXISTS forecast_event_calendar_scope_check,
  DROP CONSTRAINT IF EXISTS forecast_event_calendar_scope_value_check;

UPDATE forecast_event_calendar
SET
  event_type = CASE LOWER(event_type)
    WHEN 'festive' THEN 'Festive'
    WHEN 'regulatory' THEN 'Regulatory'
    WHEN 'promotional' THEN 'Promotional'
    WHEN 'holiday' THEN 'Holiday'
    WHEN 'other' THEN 'Other'
    ELSE event_type
  END,
  scope = CASE LOWER(scope)
    WHEN 'national' THEN 'National'
    WHEN 'zone' THEN 'Zone'
    WHEN 'state' THEN 'State'
    ELSE scope
  END;

ALTER TABLE forecast_event_calendar
  ALTER COLUMN event_type SET DEFAULT 'Festive',
  ALTER COLUMN scope SET DEFAULT 'National';

ALTER TABLE forecast_event_calendar
  ADD CONSTRAINT forecast_event_calendar_event_type_check CHECK (event_type IN ('Festive', 'Regulatory', 'Promotional', 'Holiday', 'Other')),
  ADD CONSTRAINT forecast_event_calendar_scope_check CHECK (scope IN ('National', 'Zone', 'State')),
  ADD CONSTRAINT forecast_event_calendar_scope_value_check CHECK (
    (scope = 'National' AND scope_value IS NULL)
    OR (scope IN ('Zone', 'State') AND scope_value IS NOT NULL AND LENGTH(TRIM(scope_value)) > 0)
  );

COMMIT;
