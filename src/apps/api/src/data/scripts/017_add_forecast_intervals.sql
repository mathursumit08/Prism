BEGIN;

ALTER TABLE forecast_data
  ADD COLUMN IF NOT EXISTS lower_80 INTEGER,
  ADD COLUMN IF NOT EXISTS upper_80 INTEGER,
  ADD COLUMN IF NOT EXISTS lower_95 INTEGER,
  ADD COLUMN IF NOT EXISTS upper_95 INTEGER;

UPDATE forecast_data
SET
  lower_80 = COALESCE(lower_80, forecast_units),
  upper_80 = COALESCE(upper_80, forecast_units),
  lower_95 = COALESCE(lower_95, forecast_units),
  upper_95 = COALESCE(upper_95, forecast_units);

ALTER TABLE forecast_data
  ALTER COLUMN lower_80 SET NOT NULL,
  ALTER COLUMN upper_80 SET NOT NULL,
  ALTER COLUMN lower_95 SET NOT NULL,
  ALTER COLUMN upper_95 SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'forecast_data_lower_80_nonnegative') THEN
    ALTER TABLE forecast_data ADD CONSTRAINT forecast_data_lower_80_nonnegative CHECK (lower_80 >= 0);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'forecast_data_upper_80_nonnegative') THEN
    ALTER TABLE forecast_data ADD CONSTRAINT forecast_data_upper_80_nonnegative CHECK (upper_80 >= 0);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'forecast_data_lower_95_nonnegative') THEN
    ALTER TABLE forecast_data ADD CONSTRAINT forecast_data_lower_95_nonnegative CHECK (lower_95 >= 0);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'forecast_data_upper_95_nonnegative') THEN
    ALTER TABLE forecast_data ADD CONSTRAINT forecast_data_upper_95_nonnegative CHECK (upper_95 >= 0);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'forecast_data_80_interval_order') THEN
    ALTER TABLE forecast_data ADD CONSTRAINT forecast_data_80_interval_order CHECK (lower_80 <= forecast_units AND forecast_units <= upper_80);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'forecast_data_95_interval_order') THEN
    ALTER TABLE forecast_data ADD CONSTRAINT forecast_data_95_interval_order CHECK (lower_95 <= lower_80 AND upper_80 <= upper_95);
  END IF;
END $$;

ALTER TABLE forecast_runs
  ADD COLUMN IF NOT EXISTS coverage_80 NUMERIC(5, 2),
  ADD COLUMN IF NOT EXISTS coverage_95 NUMERIC(5, 2),
  ADD COLUMN IF NOT EXISTS calibration_sample_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS avg_width_80 NUMERIC(12, 2),
  ADD COLUMN IF NOT EXISTS avg_width_95 NUMERIC(12, 2),
  ADD COLUMN IF NOT EXISTS horizon_widths JSONB NOT NULL DEFAULT '[]'::JSONB;

COMMIT;
