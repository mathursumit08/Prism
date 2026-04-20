BEGIN;

CREATE TABLE IF NOT EXISTS dealers (
  dealer_id VARCHAR(16) PRIMARY KEY,
  dealer_name VARCHAR(80) NOT NULL,
  region VARCHAR(32) NOT NULL,
  city VARCHAR(80) NOT NULL,
  state VARCHAR(80) NOT NULL,
  dealer_type VARCHAR(32) NOT NULL,
  sales_capacity_per_month INTEGER NOT NULL CHECK (sales_capacity_per_month >= 0)
);

CREATE TABLE IF NOT EXISTS vehicle_models (
  model_id VARCHAR(16) PRIMARY KEY,
  model VARCHAR(80) NOT NULL,
  manufacturer VARCHAR(80) NOT NULL,
  segment VARCHAR(40) NOT NULL,
  launch_year INTEGER NOT NULL CHECK (launch_year >= 1900)
);

CREATE TABLE IF NOT EXISTS vehicle_variants (
  variant_id VARCHAR(16) PRIMARY KEY,
  model_id VARCHAR(16) NOT NULL REFERENCES vehicle_models(model_id) ON UPDATE CASCADE ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  variant VARCHAR(80) NOT NULL,
  fuel_type VARCHAR(32) NOT NULL,
  transmission VARCHAR(32) NOT NULL,
  ex_showroom_price NUMERIC(12, 2) NOT NULL CHECK (ex_showroom_price >= 0)
);

CREATE TABLE IF NOT EXISTS sales_personnel (
  employee_id VARCHAR(16) PRIMARY KEY,
  employee_name VARCHAR(120) NOT NULL,
  role VARCHAR(64) NOT NULL,
  reports_to_id VARCHAR(16) REFERENCES sales_personnel(employee_id) ON UPDATE CASCADE ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED,
  dealer_id VARCHAR(16) REFERENCES dealers(dealer_id) ON UPDATE CASCADE ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED,
  region VARCHAR(32) NOT NULL,
  hire_date DATE NOT NULL
);

CREATE TABLE IF NOT EXISTS monthly_sales_data (
  month DATE NOT NULL,
  dealer_id VARCHAR(16) NOT NULL REFERENCES dealers(dealer_id) ON UPDATE CASCADE ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  model_id VARCHAR(16) NOT NULL REFERENCES vehicle_models(model_id) ON UPDATE CASCADE ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  variant_id VARCHAR(16) NOT NULL REFERENCES vehicle_variants(variant_id) ON UPDATE CASCADE ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  units_sold INTEGER NOT NULL CHECK (units_sold >= 0),
  stock_available INTEGER NOT NULL CHECK (stock_available >= 0),
  inventory_days NUMERIC(8, 2) NOT NULL CHECK (inventory_days >= 0),
  average_discount_pct NUMERIC(5, 2) NOT NULL CHECK (average_discount_pct >= 0),
  marketing_spend NUMERIC(12, 2) NOT NULL CHECK (marketing_spend >= 0),
  test_drives INTEGER NOT NULL CHECK (test_drives >= 0),
  enquiries INTEGER NOT NULL CHECK (enquiries >= 0),
  active_sales_executives INTEGER NOT NULL CHECK (active_sales_executives >= 0),
  dealer_manager_id VARCHAR(16) NOT NULL REFERENCES sales_personnel(employee_id) ON UPDATE CASCADE ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  regional_manager_id VARCHAR(16) NOT NULL REFERENCES sales_personnel(employee_id) ON UPDATE CASCADE ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  festival_month BOOLEAN NOT NULL,
  economic_index NUMERIC(8, 2) NOT NULL,
  competitor_index NUMERIC(8, 2) NOT NULL,
  PRIMARY KEY (month, dealer_id, model_id, variant_id)
);

CREATE TABLE IF NOT EXISTS stock_data (
  month DATE NOT NULL,
  dealer_id VARCHAR(16) NOT NULL REFERENCES dealers(dealer_id) ON UPDATE CASCADE ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  model_id VARCHAR(16) NOT NULL REFERENCES vehicle_models(model_id) ON UPDATE CASCADE ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  variant_id VARCHAR(16) NOT NULL REFERENCES vehicle_variants(variant_id) ON UPDATE CASCADE ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  opening_stock INTEGER NOT NULL CHECK (opening_stock >= 0),
  stock_received INTEGER NOT NULL CHECK (stock_received >= 0),
  units_sold INTEGER NOT NULL CHECK (units_sold >= 0),
  closing_stock INTEGER NOT NULL CHECK (closing_stock >= 0),
  inventory_days NUMERIC(8, 2) NOT NULL CHECK (inventory_days >= 0),
  PRIMARY KEY (month, dealer_id, model_id, variant_id)
);

CREATE TABLE IF NOT EXISTS customer_sales_data (
  sale_id VARCHAR(16) PRIMARY KEY,
  sale_date DATE NOT NULL,
  month DATE NOT NULL,
  customer_id VARCHAR(16) NOT NULL,
  dealer_id VARCHAR(16) NOT NULL REFERENCES dealers(dealer_id) ON UPDATE CASCADE ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  salesperson_id VARCHAR(16) NOT NULL REFERENCES sales_personnel(employee_id) ON UPDATE CASCADE ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  reports_to_id VARCHAR(16) REFERENCES sales_personnel(employee_id) ON UPDATE CASCADE ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED,
  dealer_manager_id VARCHAR(16) NOT NULL REFERENCES sales_personnel(employee_id) ON UPDATE CASCADE ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  regional_manager_id VARCHAR(16) NOT NULL REFERENCES sales_personnel(employee_id) ON UPDATE CASCADE ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  model_id VARCHAR(16) NOT NULL REFERENCES vehicle_models(model_id) ON UPDATE CASCADE ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  variant_id VARCHAR(16) NOT NULL REFERENCES vehicle_variants(variant_id) ON UPDATE CASCADE ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  color VARCHAR(32) NOT NULL,
  customer_age INTEGER NOT NULL CHECK (customer_age >= 0),
  gender VARCHAR(32) NOT NULL,
  profession VARCHAR(80) NOT NULL,
  buyer_type VARCHAR(40) NOT NULL,
  annual_income NUMERIC(14, 2) NOT NULL CHECK (annual_income >= 0),
  payment_method VARCHAR(40) NOT NULL,
  down_payment NUMERIC(12, 2) NOT NULL CHECK (down_payment >= 0),
  financed_amount NUMERIC(12, 2) NOT NULL CHECK (financed_amount >= 0),
  discount_pct NUMERIC(5, 2) NOT NULL CHECK (discount_pct >= 0),
  final_sale_price NUMERIC(12, 2) NOT NULL CHECK (final_sale_price >= 0),
  sales_channel VARCHAR(40) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_dealers_region ON dealers(region);
CREATE INDEX IF NOT EXISTS idx_vehicle_variants_model_id ON vehicle_variants(model_id);
CREATE INDEX IF NOT EXISTS idx_sales_personnel_dealer_id ON sales_personnel(dealer_id);
CREATE INDEX IF NOT EXISTS idx_sales_personnel_reports_to_id ON sales_personnel(reports_to_id);
CREATE INDEX IF NOT EXISTS idx_monthly_sales_month ON monthly_sales_data(month);
CREATE INDEX IF NOT EXISTS idx_monthly_sales_dealer_id ON monthly_sales_data(dealer_id);
CREATE INDEX IF NOT EXISTS idx_monthly_sales_variant_id ON monthly_sales_data(variant_id);
CREATE INDEX IF NOT EXISTS idx_stock_month ON stock_data(month);
CREATE INDEX IF NOT EXISTS idx_stock_dealer_id ON stock_data(dealer_id);
CREATE INDEX IF NOT EXISTS idx_stock_variant_id ON stock_data(variant_id);
CREATE INDEX IF NOT EXISTS idx_customer_sales_sale_date ON customer_sales_data(sale_date);
CREATE INDEX IF NOT EXISTS idx_customer_sales_month ON customer_sales_data(month);
CREATE INDEX IF NOT EXISTS idx_customer_sales_dealer_id ON customer_sales_data(dealer_id);
CREATE INDEX IF NOT EXISTS idx_customer_sales_salesperson_id ON customer_sales_data(salesperson_id);
CREATE INDEX IF NOT EXISTS idx_customer_sales_customer_id ON customer_sales_data(customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_sales_variant_id ON customer_sales_data(variant_id);

COMMIT;


