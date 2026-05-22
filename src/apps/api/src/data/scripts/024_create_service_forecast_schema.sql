BEGIN;

ALTER TABLE forecast_runs
  ADD COLUMN IF NOT EXISTS forecast_domain VARCHAR(32) NOT NULL DEFAULT 'Sales';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'forecast_runs_domain_allowed') THEN
    ALTER TABLE forecast_runs
      ADD CONSTRAINT forecast_runs_domain_allowed
      CHECK (forecast_domain IN ('Sales', 'Parts', 'Service'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_forecast_runs_domain_latest
  ON forecast_runs (forecast_domain, forecast_type, status, completed_at DESC);

ALTER TABLE vehicle_models
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS is_discontinued BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE vehicle_variants
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS is_discontinued BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE dealers
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

CREATE TABLE IF NOT EXISTS service_centers (
  service_center_id VARCHAR(16) PRIMARY KEY,
  service_center_name VARCHAR(120) NOT NULL,
  region VARCHAR(32) NOT NULL,
  city VARCHAR(80) NOT NULL,
  state VARCHAR(80) NOT NULL,
  center_type VARCHAR(40) NOT NULL,
  service_capacity_per_day INTEGER NOT NULL CHECK (service_capacity_per_day >= 0),
  active_technicians INTEGER NOT NULL DEFAULT 0 CHECK (active_technicians >= 0),
  service_bays INTEGER NOT NULL DEFAULT 0 CHECK (service_bays >= 0),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS service_parts (
  part_id VARCHAR(32) PRIMARY KEY,
  part_number VARCHAR(64) NOT NULL UNIQUE,
  part_name VARCHAR(160) NOT NULL,
  part_category VARCHAR(80) NOT NULL,
  part_type VARCHAR(80),
  uom VARCHAR(20) NOT NULL DEFAULT 'EA',
  unit_cost NUMERIC(12, 2) CHECK (unit_cost >= 0),
  criticality VARCHAR(32),
  abc_class VARCHAR(8),
  replaced_by_part_id VARCHAR(32) REFERENCES service_parts(part_id) ON UPDATE CASCADE ON DELETE SET NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS monthly_service_parts_demand (
  demand_id BIGSERIAL PRIMARY KEY,
  month DATE NOT NULL,
  service_center_id VARCHAR(16) NOT NULL REFERENCES service_centers(service_center_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  part_id VARCHAR(32) NOT NULL REFERENCES service_parts(part_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  model_id VARCHAR(16) REFERENCES vehicle_models(model_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  variant_id VARCHAR(16) REFERENCES vehicle_variants(variant_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  quantity_demanded INTEGER NOT NULL CHECK (quantity_demanded >= 0),
  quantity_fulfilled INTEGER NOT NULL CHECK (quantity_fulfilled >= 0),
  quantity_backordered INTEGER NOT NULL DEFAULT 0 CHECK (quantity_backordered >= 0),
  lost_sales_quantity INTEGER NOT NULL DEFAULT 0 CHECK (lost_sales_quantity >= 0),
  opening_stock INTEGER NOT NULL DEFAULT 0 CHECK (opening_stock >= 0),
  stock_received INTEGER NOT NULL DEFAULT 0 CHECK (stock_received >= 0),
  closing_stock INTEGER NOT NULL DEFAULT 0 CHECK (closing_stock >= 0),
  stockout_days INTEGER NOT NULL DEFAULT 0 CHECK (stockout_days >= 0),
  average_lead_time_days NUMERIC(8, 2) CHECK (average_lead_time_days >= 0),
  warranty_quantity INTEGER NOT NULL DEFAULT 0 CHECK (warranty_quantity >= 0),
  paid_quantity INTEGER NOT NULL DEFAULT 0 CHECK (paid_quantity >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_monthly_service_parts_demand_unique
  ON monthly_service_parts_demand (month, service_center_id, part_id, model_id, variant_id) NULLS NOT DISTINCT;

CREATE TABLE IF NOT EXISTS service_orders (
  service_order_id VARCHAR(32) PRIMARY KEY,
  order_date DATE NOT NULL,
  month DATE NOT NULL,
  service_center_id VARCHAR(16) NOT NULL REFERENCES service_centers(service_center_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  model_id VARCHAR(16) REFERENCES vehicle_models(model_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  variant_id VARCHAR(16) REFERENCES vehicle_variants(variant_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  service_type VARCHAR(80) NOT NULL,
  job_category VARCHAR(80),
  service_channel VARCHAR(40),
  status VARCHAR(40) NOT NULL,
  warranty_flag BOOLEAN NOT NULL DEFAULT FALSE,
  repeat_repair_flag BOOLEAN NOT NULL DEFAULT FALSE,
  campaign_flag BOOLEAN NOT NULL DEFAULT FALSE,
  appointment_flag BOOLEAN NOT NULL DEFAULT FALSE,
  promised_delivery_date DATE,
  completed_date DATE,
  labor_hours NUMERIC(8, 2) CHECK (labor_hours >= 0),
  bay_hours NUMERIC(8, 2) CHECK (bay_hours >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS monthly_service_order_volume (
  volume_id BIGSERIAL PRIMARY KEY,
  month DATE NOT NULL,
  service_center_id VARCHAR(16) NOT NULL REFERENCES service_centers(service_center_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  service_type VARCHAR(80) NOT NULL,
  job_category VARCHAR(80),
  model_id VARCHAR(16) REFERENCES vehicle_models(model_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  variant_id VARCHAR(16) REFERENCES vehicle_variants(variant_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  order_count INTEGER NOT NULL CHECK (order_count >= 0),
  completed_count INTEGER NOT NULL DEFAULT 0 CHECK (completed_count >= 0),
  cancelled_count INTEGER NOT NULL DEFAULT 0 CHECK (cancelled_count >= 0),
  warranty_count INTEGER NOT NULL DEFAULT 0 CHECK (warranty_count >= 0),
  repeat_repair_count INTEGER NOT NULL DEFAULT 0 CHECK (repeat_repair_count >= 0),
  available_technicians INTEGER CHECK (available_technicians >= 0),
  available_bays INTEGER CHECK (available_bays >= 0),
  working_days INTEGER CHECK (working_days >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_monthly_service_order_volume_unique
  ON monthly_service_order_volume (month, service_center_id, service_type, job_category, model_id, variant_id) NULLS NOT DISTINCT;

CREATE TABLE IF NOT EXISTS parts_forecast_data (
  forecast_id BIGSERIAL PRIMARY KEY,
  run_id BIGINT NOT NULL REFERENCES forecast_runs(run_id) ON DELETE CASCADE,
  forecast_type VARCHAR(32) NOT NULL,
  level VARCHAR(16) NOT NULL CHECK (level IN ('service_center', 'state', 'zone')),
  group_id VARCHAR(120) NOT NULL,
  group_label VARCHAR(160) NOT NULL,
  part_id VARCHAR(32) REFERENCES service_parts(part_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  part_category VARCHAR(80),
  model_id VARCHAR(16) REFERENCES vehicle_models(model_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  variant_id VARCHAR(16) REFERENCES vehicle_variants(variant_id) ON UPDATE CASCADE ON DELETE RESTRICT,
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
  CONSTRAINT parts_forecast_data_80_interval_order CHECK (lower_80 <= forecast_units AND forecast_units <= upper_80),
  CONSTRAINT parts_forecast_data_95_interval_order CHECK (lower_95 <= lower_80 AND upper_80 <= upper_95)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_parts_forecast_data_refresh_unique
  ON parts_forecast_data (forecast_type, level, group_id, part_id, part_category, model_id, variant_id, forecast_month) NULLS NOT DISTINCT;

CREATE TABLE IF NOT EXISTS service_forecast_data (
  forecast_id BIGSERIAL PRIMARY KEY,
  run_id BIGINT NOT NULL REFERENCES forecast_runs(run_id) ON DELETE CASCADE,
  forecast_type VARCHAR(32) NOT NULL,
  level VARCHAR(16) NOT NULL CHECK (level IN ('service_center', 'state', 'zone')),
  group_id VARCHAR(120) NOT NULL,
  group_label VARCHAR(160) NOT NULL,
  service_type VARCHAR(80),
  job_category VARCHAR(80),
  model_id VARCHAR(16) REFERENCES vehicle_models(model_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  variant_id VARCHAR(16) REFERENCES vehicle_variants(variant_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  forecast_month DATE NOT NULL,
  forecast_orders INTEGER NOT NULL CHECK (forecast_orders >= 0),
  lower_80 INTEGER NOT NULL CHECK (lower_80 >= 0),
  upper_80 INTEGER NOT NULL CHECK (upper_80 >= 0),
  lower_95 INTEGER NOT NULL CHECK (lower_95 >= 0),
  upper_95 INTEGER NOT NULL CHECK (upper_95 >= 0),
  model_method VARCHAR(120) NOT NULL,
  validation_mae NUMERIC(12, 2),
  validation_rmse NUMERIC(12, 2),
  validation_mape NUMERIC(12, 2),
  data_quality VARCHAR(16) NOT NULL DEFAULT 'rich' CHECK (data_quality IN ('rich', 'sparse', 'fallback')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT service_forecast_data_80_interval_order CHECK (lower_80 <= forecast_orders AND forecast_orders <= upper_80),
  CONSTRAINT service_forecast_data_95_interval_order CHECK (lower_95 <= lower_80 AND upper_80 <= upper_95)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_service_forecast_data_refresh_unique
  ON service_forecast_data (forecast_type, level, group_id, service_type, job_category, model_id, variant_id, forecast_month) NULLS NOT DISTINCT;

CREATE INDEX IF NOT EXISTS idx_service_centers_region ON service_centers(region);
CREATE INDEX IF NOT EXISTS idx_service_centers_state ON service_centers(state);
CREATE INDEX IF NOT EXISTS idx_service_parts_category ON service_parts(part_category);
CREATE INDEX IF NOT EXISTS idx_monthly_service_parts_month ON monthly_service_parts_demand(month);
CREATE INDEX IF NOT EXISTS idx_monthly_service_parts_center ON monthly_service_parts_demand(service_center_id);
CREATE INDEX IF NOT EXISTS idx_monthly_service_parts_part ON monthly_service_parts_demand(part_id);
CREATE INDEX IF NOT EXISTS idx_service_orders_month ON service_orders(month);
CREATE INDEX IF NOT EXISTS idx_service_orders_center ON service_orders(service_center_id);
CREATE INDEX IF NOT EXISTS idx_service_orders_type ON service_orders(service_type);
CREATE INDEX IF NOT EXISTS idx_monthly_service_volume_month ON monthly_service_order_volume(month);
CREATE INDEX IF NOT EXISTS idx_monthly_service_volume_center ON monthly_service_order_volume(service_center_id);
CREATE INDEX IF NOT EXISTS idx_parts_forecast_data_run_id ON parts_forecast_data(run_id);
CREATE INDEX IF NOT EXISTS idx_service_forecast_data_run_id ON service_forecast_data(run_id);

INSERT INTO roles (role_name)
VALUES
  ('Parts Manager'),
  ('Service Manager')
ON CONFLICT (role_name) DO NOTHING;

INSERT INTO permissions (permission_name)
VALUES
  ('View Parts Forecast'),
  ('Manage Parts Forecast'),
  ('View Service Forecast'),
  ('Manage Service Forecast')
ON CONFLICT (permission_name) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM roles r
JOIN permissions p ON p.permission_name = 'View Parts Forecast'
WHERE r.role_name IN ('Admin', 'National Head', 'Regional Head', 'Parts Manager')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM roles r
JOIN permissions p ON p.permission_name = 'Manage Parts Forecast'
WHERE r.role_name = 'Admin'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM roles r
JOIN permissions p ON p.permission_name = 'View Service Forecast'
WHERE r.role_name IN ('Admin', 'National Head', 'Regional Head', 'Service Manager')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM roles r
JOIN permissions p ON p.permission_name = 'Manage Service Forecast'
WHERE r.role_name = 'Admin'
ON CONFLICT DO NOTHING;

COMMIT;
