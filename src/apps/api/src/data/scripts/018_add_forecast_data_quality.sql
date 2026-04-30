BEGIN;

ALTER TABLE forecast_data
  ADD COLUMN IF NOT EXISTS data_quality VARCHAR(10) NOT NULL DEFAULT 'rich';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'forecast_data_data_quality_allowed') THEN
    ALTER TABLE forecast_data
      ADD CONSTRAINT forecast_data_data_quality_allowed
      CHECK (data_quality IN ('rich', 'sparse', 'fallback'));
  END IF;
END $$;

COMMIT;
