BEGIN;

-- Sample recurring festive-event uplift rules for baseline forecast refreshes.
INSERT INTO forecast_event_calendar (
  forecast_type,
  event_code,
  event_name,
  start_month,
  end_month,
  uplift_pct,
  is_active
)
VALUES
  ('baseline', 'NEW_YEAR', 'New Year', 1, 1, 5.00, TRUE),
  ('baseline', 'UGAADI', 'Ugaadi', 4, 4, 7.50, TRUE),
  ('baseline', 'DUSSEHRA', 'Dussehra', 10, 10, 9.00, TRUE),
  ('baseline', 'DIWALI', 'Diwali', 11, 11, 12.50, TRUE)
ON CONFLICT (forecast_type, event_code) DO UPDATE SET
  event_name = EXCLUDED.event_name,
  start_month = EXCLUDED.start_month,
  end_month = EXCLUDED.end_month,
  uplift_pct = EXCLUDED.uplift_pct,
  is_active = EXCLUDED.is_active,
  updated_at = NOW();

COMMIT;
