CREATE TABLE IF NOT EXISTS domain_forecast_rollups (
  rollup_id BIGSERIAL PRIMARY KEY,
  forecast_domain VARCHAR(20) NOT NULL CHECK (forecast_domain IN ('Parts', 'Service', 'Warranty')),
  run_id BIGINT NOT NULL REFERENCES forecast_runs(run_id) ON DELETE CASCADE,
  forecast_type VARCHAR(32) NOT NULL,
  level VARCHAR(16) NOT NULL CHECK (level IN ('service_center', 'state', 'zone')),
  group_id VARCHAR(120) NOT NULL,
  group_label VARCHAR(160) NOT NULL,
  rollup_type VARCHAR(40) NOT NULL CHECK (rollup_type IN ('total', 'part_category', 'part', 'service_type', 'job_category', 'claim_type', 'return_reason', 'age_bucket')),
  part_id VARCHAR(32),
  part_category VARCHAR(80),
  service_type VARCHAR(80),
  job_category VARCHAR(80),
  claim_type VARCHAR(80),
  return_reason VARCHAR(120),
  age_bucket VARCHAR(40),
  model_id VARCHAR(16),
  variant_id VARCHAR(16),
  forecast_month DATE NOT NULL,
  forecast_units INTEGER NOT NULL CHECK (forecast_units >= 0),
  lower_80 INTEGER NOT NULL CHECK (lower_80 >= 0),
  upper_80 INTEGER NOT NULL CHECK (upper_80 >= 0),
  lower_95 INTEGER NOT NULL CHECK (lower_95 >= 0),
  upper_95 INTEGER NOT NULL CHECK (upper_95 >= 0),
  model_method VARCHAR(120) NOT NULL,
  validation_mae NUMERIC(12, 2),
  validation_rmse NUMERIC(12, 2),
  validation_mape NUMERIC(12, 2),
  data_quality VARCHAR(16) NOT NULL DEFAULT 'rich' CHECK (data_quality IN ('rich', 'sparse', 'fallback', 'intermittent')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT domain_forecast_rollups_80_interval_order CHECK (lower_80 <= forecast_units AND forecast_units <= upper_80),
  CONSTRAINT domain_forecast_rollups_95_interval_order CHECK (lower_95 <= lower_80 AND upper_80 <= upper_95)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_domain_forecast_rollups_unique
  ON domain_forecast_rollups (
    forecast_domain,
    run_id,
    forecast_type,
    level,
    group_id,
    rollup_type,
    part_id,
    part_category,
    service_type,
    job_category,
    claim_type,
    return_reason,
    age_bucket,
    model_id,
    variant_id,
    forecast_month
  ) NULLS NOT DISTINCT;

CREATE INDEX IF NOT EXISTS idx_domain_forecast_rollups_lookup
  ON domain_forecast_rollups (forecast_domain, run_id, forecast_type, level, group_id, rollup_type, forecast_month);

CREATE INDEX IF NOT EXISTS idx_parts_forecast_data_run_level_month
  ON parts_forecast_data (run_id, forecast_type, level, group_id, forecast_month);

CREATE INDEX IF NOT EXISTS idx_service_forecast_data_run_level_month
  ON service_forecast_data (run_id, forecast_type, level, group_id, forecast_month);

CREATE INDEX IF NOT EXISTS idx_warranty_forecast_data_run_id
  ON warranty_forecast_data(run_id);

CREATE INDEX IF NOT EXISTS idx_warranty_forecast_data_run_level_month
  ON warranty_forecast_data (run_id, forecast_type, level, group_id, forecast_month);

CREATE INDEX IF NOT EXISTS idx_forecast_runs_domain_type_status_completed
  ON forecast_runs (forecast_domain, forecast_type, status, completed_at DESC);

CREATE OR REPLACE PROCEDURE refresh_domain_forecast_rollups(
  p_forecast_domain VARCHAR,
  p_run_id BIGINT,
  p_forecast_type VARCHAR
)
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM domain_forecast_rollups
  WHERE forecast_domain = p_forecast_domain
    AND run_id = p_run_id
    AND forecast_type = p_forecast_type;

  IF p_forecast_domain = 'Parts' THEN
    INSERT INTO domain_forecast_rollups (
      forecast_domain, run_id, forecast_type, level, group_id, group_label, rollup_type,
      part_id, part_category, service_type, job_category, claim_type, return_reason, age_bucket, model_id, variant_id,
      forecast_month, forecast_units, lower_80, upper_80, lower_95, upper_95,
      model_method, validation_mae, validation_rmse, validation_mape, data_quality
    )
    SELECT
      'Parts',
      p_run_id,
      p_forecast_type,
      fd.level,
      fd.group_id,
      fd.group_label,
      rollup.rollup_type,
      rollup.part_id,
      rollup.part_category,
      NULL::VARCHAR,
      NULL::VARCHAR,
      NULL::VARCHAR,
      NULL::VARCHAR,
      NULL::VARCHAR,
      NULL::VARCHAR,
      NULL::VARCHAR,
      fd.forecast_month,
      SUM(fd.forecast_units)::INTEGER,
      ROUND(GREATEST(0, SUM(fd.forecast_units) - SQRT(SUM(POWER(GREATEST(fd.forecast_units - fd.lower_80, 0), 2)))))::INTEGER,
      ROUND(SUM(fd.forecast_units) + SQRT(SUM(POWER(GREATEST(fd.upper_80 - fd.forecast_units, 0), 2))))::INTEGER,
      ROUND(GREATEST(0, SUM(fd.forecast_units) - SQRT(SUM(POWER(GREATEST(fd.forecast_units - fd.lower_95, 0), 2)))))::INTEGER,
      ROUND(SUM(fd.forecast_units) + SQRT(SUM(POWER(GREATEST(fd.upper_95 - fd.forecast_units, 0), 2))))::INTEGER,
      CASE WHEN COUNT(DISTINCT fd.model_method) = 1 THEN MIN(fd.model_method) ELSE 'aggregated-domain-forecast' END,
      AVG(fd.validation_mae),
      AVG(fd.validation_rmse),
      AVG(fd.validation_mape),
      CASE WHEN COUNT(DISTINCT fd.data_quality) = 1 THEN MIN(fd.data_quality) ELSE 'sparse' END
    FROM parts_forecast_data fd
    CROSS JOIN LATERAL (
      VALUES
        ('total'::VARCHAR, NULL::VARCHAR, NULL::VARCHAR),
        ('part_category'::VARCHAR, NULL::VARCHAR, fd.part_category),
        ('part'::VARCHAR, fd.part_id, fd.part_category)
    ) AS rollup(rollup_type, part_id, part_category)
    WHERE fd.run_id = p_run_id
      AND fd.forecast_type = p_forecast_type
      AND (rollup.rollup_type = 'total' OR rollup.part_category IS NOT NULL)
    GROUP BY fd.level, fd.group_id, fd.group_label, rollup.rollup_type, rollup.part_id, rollup.part_category, fd.forecast_month;

  ELSIF p_forecast_domain = 'Service' THEN
    INSERT INTO domain_forecast_rollups (
      forecast_domain, run_id, forecast_type, level, group_id, group_label, rollup_type,
      part_id, part_category, service_type, job_category, claim_type, return_reason, age_bucket, model_id, variant_id,
      forecast_month, forecast_units, lower_80, upper_80, lower_95, upper_95,
      model_method, validation_mae, validation_rmse, validation_mape, data_quality
    )
    SELECT
      'Service',
      p_run_id,
      p_forecast_type,
      fd.level,
      fd.group_id,
      fd.group_label,
      rollup.rollup_type,
      NULL::VARCHAR,
      NULL::VARCHAR,
      rollup.service_type,
      rollup.job_category,
      NULL::VARCHAR,
      NULL::VARCHAR,
      NULL::VARCHAR,
      NULL::VARCHAR,
      NULL::VARCHAR,
      fd.forecast_month,
      SUM(fd.forecast_orders)::INTEGER,
      ROUND(GREATEST(0, SUM(fd.forecast_orders) - SQRT(SUM(POWER(GREATEST(fd.forecast_orders - fd.lower_80, 0), 2)))))::INTEGER,
      ROUND(SUM(fd.forecast_orders) + SQRT(SUM(POWER(GREATEST(fd.upper_80 - fd.forecast_orders, 0), 2))))::INTEGER,
      ROUND(GREATEST(0, SUM(fd.forecast_orders) - SQRT(SUM(POWER(GREATEST(fd.forecast_orders - fd.lower_95, 0), 2)))))::INTEGER,
      ROUND(SUM(fd.forecast_orders) + SQRT(SUM(POWER(GREATEST(fd.upper_95 - fd.forecast_orders, 0), 2))))::INTEGER,
      CASE WHEN COUNT(DISTINCT fd.model_method) = 1 THEN MIN(fd.model_method) ELSE 'aggregated-domain-forecast' END,
      AVG(fd.validation_mae),
      AVG(fd.validation_rmse),
      AVG(fd.validation_mape),
      CASE WHEN COUNT(DISTINCT fd.data_quality) = 1 THEN MIN(fd.data_quality) ELSE 'sparse' END
    FROM service_forecast_data fd
    CROSS JOIN LATERAL (
      VALUES
        ('total'::VARCHAR, NULL::VARCHAR, NULL::VARCHAR),
        ('service_type'::VARCHAR, fd.service_type, NULL::VARCHAR),
        ('job_category'::VARCHAR, fd.service_type, fd.job_category)
    ) AS rollup(rollup_type, service_type, job_category)
    WHERE fd.run_id = p_run_id
      AND fd.forecast_type = p_forecast_type
      AND (rollup.rollup_type = 'total' OR rollup.service_type IS NOT NULL OR rollup.job_category IS NOT NULL)
    GROUP BY fd.level, fd.group_id, fd.group_label, rollup.rollup_type, rollup.service_type, rollup.job_category, fd.forecast_month;

  ELSIF p_forecast_domain = 'Warranty' THEN
    INSERT INTO domain_forecast_rollups (
      forecast_domain, run_id, forecast_type, level, group_id, group_label, rollup_type,
      part_id, part_category, service_type, job_category, claim_type, return_reason, age_bucket, model_id, variant_id,
      forecast_month, forecast_units, lower_80, upper_80, lower_95, upper_95,
      model_method, validation_mae, validation_rmse, validation_mape, data_quality
    )
    SELECT
      'Warranty',
      p_run_id,
      p_forecast_type,
      fd.level,
      fd.group_id,
      fd.group_label,
      rollup.rollup_type,
      NULL::VARCHAR,
      NULL::VARCHAR,
      NULL::VARCHAR,
      NULL::VARCHAR,
      rollup.claim_type,
      rollup.return_reason,
      rollup.age_bucket,
      NULL::VARCHAR,
      NULL::VARCHAR,
      fd.forecast_month,
      SUM(fd.forecast_units)::INTEGER,
      ROUND(GREATEST(0, SUM(fd.forecast_units) - SQRT(SUM(POWER(GREATEST(fd.forecast_units - fd.lower_80, 0), 2)))))::INTEGER,
      ROUND(SUM(fd.forecast_units) + SQRT(SUM(POWER(GREATEST(fd.upper_80 - fd.forecast_units, 0), 2))))::INTEGER,
      ROUND(GREATEST(0, SUM(fd.forecast_units) - SQRT(SUM(POWER(GREATEST(fd.forecast_units - fd.lower_95, 0), 2)))))::INTEGER,
      ROUND(SUM(fd.forecast_units) + SQRT(SUM(POWER(GREATEST(fd.upper_95 - fd.forecast_units, 0), 2))))::INTEGER,
      CASE WHEN COUNT(DISTINCT fd.model_method) = 1 THEN MIN(fd.model_method) ELSE 'aggregated-domain-forecast' END,
      AVG(fd.validation_mae),
      AVG(fd.validation_rmse),
      AVG(fd.validation_mape),
      CASE WHEN COUNT(DISTINCT fd.data_quality) = 1 THEN MIN(fd.data_quality) ELSE 'sparse' END
    FROM warranty_forecast_data fd
    CROSS JOIN LATERAL (
      VALUES
        ('total'::VARCHAR, NULL::VARCHAR, NULL::VARCHAR, NULL::VARCHAR),
        ('claim_type'::VARCHAR, fd.claim_type, NULL::VARCHAR, NULL::VARCHAR),
        ('return_reason'::VARCHAR, fd.claim_type, fd.return_reason, NULL::VARCHAR),
        ('age_bucket'::VARCHAR, fd.claim_type, fd.return_reason, fd.age_bucket)
    ) AS rollup(rollup_type, claim_type, return_reason, age_bucket)
    WHERE fd.run_id = p_run_id
      AND fd.forecast_type = p_forecast_type
      AND (
        rollup.rollup_type = 'total'
        OR rollup.claim_type IS NOT NULL
        OR rollup.return_reason IS NOT NULL
        OR rollup.age_bucket IS NOT NULL
      )
    GROUP BY fd.level, fd.group_id, fd.group_label, rollup.rollup_type, rollup.claim_type, rollup.return_reason, rollup.age_bucket, fd.forecast_month;

  ELSE
    RAISE EXCEPTION 'Unsupported forecast domain %', p_forecast_domain;
  END IF;
END;
$$;

CREATE OR REPLACE PROCEDURE backfill_domain_forecast_rollups(
  p_forecast_domain VARCHAR DEFAULT NULL,
  p_forecast_type VARCHAR DEFAULT NULL
)
LANGUAGE plpgsql
AS $$
DECLARE
  forecast_run RECORD;
BEGIN
  FOR forecast_run IN
    SELECT run_id, forecast_domain, forecast_type
    FROM forecast_runs
    WHERE status = 'completed'
      AND forecast_domain IN ('Parts', 'Service', 'Warranty')
      AND (p_forecast_domain IS NULL OR forecast_domain = p_forecast_domain)
      AND (p_forecast_type IS NULL OR forecast_type = p_forecast_type)
    ORDER BY completed_at NULLS LAST, run_id
  LOOP
    CALL refresh_domain_forecast_rollups(
      forecast_run.forecast_domain,
      forecast_run.run_id,
      forecast_run.forecast_type
    );
  END LOOP;
END;
$$;
