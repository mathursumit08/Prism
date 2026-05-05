BEGIN;

CREATE INDEX IF NOT EXISTS idx_forecast_data_run_lookup_month
  ON forecast_data (
    run_id,
    forecast_type,
    level,
    group_id,
    segment,
    model_id,
    variant_id,
    forecast_month
  );

CREATE INDEX IF NOT EXISTS idx_forecast_data_segment_breakdown_month
  ON forecast_data (
    run_id,
    forecast_type,
    level,
    group_id,
    segment,
    forecast_month
  )
  WHERE segment IS NOT NULL;

COMMIT;
