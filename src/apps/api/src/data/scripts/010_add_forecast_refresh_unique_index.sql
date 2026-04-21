BEGIN;

-- Remove duplicate forecast rows left by older append-style reruns before adding the unique index.
WITH ranked_duplicates AS (
  SELECT
    forecast_id,
    ROW_NUMBER() OVER (
      PARTITION BY forecast_type, level, group_id, model_id, variant_id, forecast_month
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

-- Supports refresh-style upserts where NULL model_id and variant_id should still conflict.
CREATE UNIQUE INDEX IF NOT EXISTS idx_forecast_data_refresh_unique
  ON forecast_data (
    forecast_type,
    level,
    group_id,
    model_id,
    variant_id,
    forecast_month
  ) NULLS NOT DISTINCT;

COMMIT;
