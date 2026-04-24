BEGIN;

ALTER TABLE forecast_data
ADD COLUMN IF NOT EXISTS segment VARCHAR(40);

UPDATE forecast_data fd
SET segment = vm.segment
FROM vehicle_models vm
WHERE fd.segment IS NULL
  AND fd.model_id = vm.model_id;

DROP INDEX IF EXISTS idx_forecast_data_lookup;

CREATE INDEX IF NOT EXISTS idx_forecast_data_lookup
  ON forecast_data (forecast_type, level, group_id, segment, model_id, variant_id, forecast_month);

DROP INDEX IF EXISTS idx_forecast_data_refresh_unique;

WITH ranked_duplicates AS (
  SELECT
    forecast_id,
    ROW_NUMBER() OVER (
      PARTITION BY forecast_type, level, group_id, segment, model_id, variant_id, forecast_month
      ORDER BY generated_at DESC, run_id DESC, forecast_id DESC
    ) AS row_rank
  FROM forecast_data
)
DELETE FROM forecast_data
WHERE forecast_id IN (
  SELECT forecast_id
  FROM ranked_duplicates
  WHERE row_rank > 1
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_forecast_data_refresh_unique
  ON forecast_data (
    forecast_type,
    level,
    group_id,
    segment,
    model_id,
    variant_id,
    forecast_month
  ) NULLS NOT DISTINCT;

COMMIT;
