BEGIN;

SET CONSTRAINTS ALL DEFERRED;

-- Extends operational sample data through May 2026. April and May rows are
-- generated idempotently from the latest available prior month.
WITH month_specs AS (
  SELECT DATE '2026-04-01' AS target_month, DATE '2026-03-01' AS source_month, 1.02::NUMERIC AS growth_factor, TRUE AS festival_month, 121.45::NUMERIC AS economic_index, 102.85::NUMERIC AS competitor_index
  UNION ALL
  SELECT DATE '2026-05-01' AS target_month, DATE '2026-04-01' AS source_month, 1.01::NUMERIC AS growth_factor, FALSE AS festival_month, 121.90::NUMERIC AS economic_index, 102.40::NUMERIC AS competitor_index
),
derived_monthly AS (
  SELECT
    ms.target_month AS month,
    s.dealer_id,
    s.model_id,
    s.variant_id,
    GREATEST(1, ROUND(s.units_sold * ms.growth_factor * (0.94 + (ABS(('x' || SUBSTRING(MD5(s.dealer_id || s.variant_id || ms.target_month::TEXT), 1, 8))::BIT(32)::INT) % 13) / 100.0)))::INTEGER AS units_sold,
    s.stock_available,
    s.inventory_days,
    LEAST(8.00, GREATEST(2.00, s.average_discount_pct + (((ABS(('x' || SUBSTRING(MD5('discount' || s.dealer_id || s.variant_id || ms.target_month::TEXT), 1, 8))::BIT(32)::INT) % 9) - 4) / 100.0)))::NUMERIC(5,2) AS average_discount_pct,
    s.marketing_spend,
    s.test_drives,
    s.enquiries,
    s.active_sales_executives,
    s.dealer_manager_id,
    s.regional_manager_id,
    ms.festival_month,
    ms.economic_index,
    ms.competitor_index
  FROM month_specs ms
  JOIN monthly_sales_data s ON s.month = ms.source_month
),
final_monthly AS (
  SELECT
    dm.month,
    dm.dealer_id,
    dm.model_id,
    dm.variant_id,
    dm.units_sold,
    GREATEST(dm.units_sold, ROUND(dm.units_sold * (2.0 + (ABS(('x' || SUBSTRING(MD5('stock' || dm.dealer_id || dm.variant_id || dm.month::TEXT), 1, 8))::BIT(32)::INT) % 9) / 10.0)))::INTEGER AS stock_available,
    ROUND((28.0 + (ABS(('x' || SUBSTRING(MD5('inventory' || dm.dealer_id || dm.variant_id || dm.month::TEXT), 1, 8))::BIT(32)::INT) % 130) / 10.0)::NUMERIC, 1)::NUMERIC(8,2) AS inventory_days,
    dm.average_discount_pct,
    ROUND((dm.marketing_spend * (0.96 + (ABS(('x' || SUBSTRING(MD5('marketing' || dm.dealer_id || dm.variant_id || dm.month::TEXT), 1, 8))::BIT(32)::INT) % 11) / 100.0))::NUMERIC, 2)::NUMERIC(12,2) AS marketing_spend,
    GREATEST(0, ROUND(dm.test_drives * (0.95 + (ABS(('x' || SUBSTRING(MD5('testdrive' || dm.dealer_id || dm.variant_id || dm.month::TEXT), 1, 8))::BIT(32)::INT) % 12) / 100.0)))::INTEGER AS test_drives,
    GREATEST(0, ROUND(dm.enquiries * (0.95 + (ABS(('x' || SUBSTRING(MD5('enquiry' || dm.dealer_id || dm.variant_id || dm.month::TEXT), 1, 8))::BIT(32)::INT) % 12) / 100.0)))::INTEGER AS enquiries,
    dm.active_sales_executives,
    dm.dealer_manager_id,
    dm.regional_manager_id,
    dm.festival_month,
    dm.economic_index,
    dm.competitor_index
  FROM derived_monthly dm
)
INSERT INTO monthly_sales_data (
  month,
  dealer_id,
  model_id,
  variant_id,
  units_sold,
  stock_available,
  inventory_days,
  average_discount_pct,
  marketing_spend,
  test_drives,
  enquiries,
  active_sales_executives,
  dealer_manager_id,
  regional_manager_id,
  festival_month,
  economic_index,
  competitor_index
)
SELECT
  month,
  dealer_id,
  model_id,
  variant_id,
  units_sold,
  stock_available,
  inventory_days,
  average_discount_pct,
  marketing_spend,
  test_drives,
  enquiries,
  active_sales_executives,
  dealer_manager_id,
  regional_manager_id,
  festival_month,
  economic_index,
  competitor_index
FROM final_monthly
ON CONFLICT (month, dealer_id, model_id, variant_id) DO NOTHING;

WITH target_months AS (
  SELECT DATE '2026-04-01' AS month
  UNION ALL
  SELECT DATE '2026-05-01' AS month
),
stock_source AS (
  SELECT
    m.month,
    m.dealer_id,
    m.model_id,
    m.variant_id,
    m.units_sold,
    m.stock_available,
    m.inventory_days,
    COALESCE(previous_stock.closing_stock, m.stock_available) AS opening_stock
  FROM monthly_sales_data m
  JOIN target_months tm ON tm.month = m.month
  LEFT JOIN stock_data previous_stock
    ON previous_stock.month = m.month - INTERVAL '1 month'
   AND previous_stock.dealer_id = m.dealer_id
   AND previous_stock.model_id = m.model_id
   AND previous_stock.variant_id = m.variant_id
)
INSERT INTO stock_data (
  month,
  dealer_id,
  model_id,
  variant_id,
  opening_stock,
  stock_received,
  units_sold,
  closing_stock,
  inventory_days
)
SELECT
  month,
  dealer_id,
  model_id,
  variant_id,
  opening_stock,
  GREATEST(0, stock_available + units_sold - opening_stock) AS stock_received,
  units_sold,
  stock_available AS closing_stock,
  inventory_days
FROM stock_source
ON CONFLICT (month, dealer_id, model_id, variant_id) DO NOTHING;

WITH target_months AS (
  SELECT DATE '2026-04-01' AS month
  UNION ALL
  SELECT DATE '2026-05-01' AS month
),
customer_months_to_seed AS (
  SELECT tm.month
  FROM target_months tm
  WHERE NOT EXISTS (
    SELECT 1
    FROM customer_sales_data existing
    WHERE existing.month = tm.month
  )
),
monthly_rows AS (
  SELECT
    m.*,
    vv.ex_showroom_price,
    ROW_NUMBER() OVER (ORDER BY m.month, m.dealer_id, m.model_id, m.variant_id) AS row_number
  FROM monthly_sales_data m
  JOIN customer_months_to_seed cmt ON cmt.month = m.month
  JOIN vehicle_variants vv ON vv.variant_id = m.variant_id
),
expanded_sales AS (
  SELECT
    mr.*,
    sale_sequence,
    ((mr.row_number - 1) * 1000 + sale_sequence) AS sale_number,
    (ABS(('x' || SUBSTRING(MD5('sale-day' || mr.dealer_id || mr.variant_id || mr.month::TEXT || sale_sequence::TEXT), 1, 8))::BIT(32)::INT) % EXTRACT(DAY FROM (mr.month + INTERVAL '1 month - 1 day')))::INTEGER + 1 AS sale_day
  FROM monthly_rows mr
  CROSS JOIN LATERAL GENERATE_SERIES(1, mr.units_sold) AS sale_sequence
),
sales_with_people AS (
  SELECT
    es.*,
    COALESCE(sales_user.username, team_lead.username, dealer_manager.username, es.dealer_manager_id) AS salesperson_id,
    COALESCE(sales_user.reports_to_id, team_lead.username, dealer_manager.username, es.dealer_manager_id) AS reports_to_id
  FROM expanded_sales es
  LEFT JOIN LATERAL (
    SELECT username, reports_to_id
    FROM users
    WHERE dealer_id = es.dealer_id
      AND job_title = 'Sales Executive'
      AND is_active = TRUE
    ORDER BY username
    OFFSET (es.sale_sequence - 1) % GREATEST(1, (
      SELECT COUNT(*)
      FROM users sales_count
      WHERE sales_count.dealer_id = es.dealer_id
        AND sales_count.job_title = 'Sales Executive'
        AND sales_count.is_active = TRUE
    ))
    LIMIT 1
  ) sales_user ON TRUE
  LEFT JOIN LATERAL (
    SELECT username
    FROM users
    WHERE dealer_id = es.dealer_id
      AND job_title = 'Team Lead'
      AND is_active = TRUE
    ORDER BY username
    LIMIT 1
  ) team_lead ON TRUE
  LEFT JOIN LATERAL (
    SELECT username
    FROM users
    WHERE username = es.dealer_manager_id
      AND is_active = TRUE
    LIMIT 1
  ) dealer_manager ON TRUE
),
final_sales AS (
  SELECT
    'SAL' || TO_CHAR(month, 'YYYYMM') || LPAD(sale_number::TEXT, 7, '0') AS sale_id,
    (month + ((sale_day - 1) * INTERVAL '1 day'))::DATE AS sale_date,
    month,
    'C' || TO_CHAR(month, 'YYYYMM') || LPAD(sale_number::TEXT, 7, '0') AS customer_id,
    dealer_id,
    salesperson_id,
    reports_to_id,
    dealer_manager_id,
    regional_manager_id,
    model_id,
    variant_id,
    (ARRAY['White', 'Black', 'Grey', 'Silver', 'Blue', 'Red'])[(ABS(('x' || SUBSTRING(MD5('color' || sale_number::TEXT), 1, 8))::BIT(32)::INT) % 6) + 1] AS color,
    ((ABS(('x' || SUBSTRING(MD5('age' || sale_number::TEXT), 1, 8))::BIT(32)::INT) % 40) + 24)::INTEGER AS customer_age,
    (ARRAY['Male', 'Female'])[(ABS(('x' || SUBSTRING(MD5('gender' || sale_number::TEXT), 1, 8))::BIT(32)::INT) % 2) + 1] AS gender,
    (ARRAY['Salaried', 'Business Owner', 'IT Professional', 'Government Employee', 'Doctor', 'Consultant'])[(ABS(('x' || SUBSTRING(MD5('profession' || sale_number::TEXT), 1, 8))::BIT(32)::INT) % 6) + 1] AS profession,
    (ARRAY['Individual', 'Business'])[(ABS(('x' || SUBSTRING(MD5('buyer' || sale_number::TEXT), 1, 8))::BIT(32)::INT) % 2) + 1] AS buyer_type,
    ((ABS(('x' || SUBSTRING(MD5('income' || sale_number::TEXT), 1, 8))::BIT(32)::INT) % 2300000) + 450000)::NUMERIC(14,2) AS annual_income,
    (ARRAY['Cash', 'Loan', 'Lease'])[(ABS(('x' || SUBSTRING(MD5('payment' || sale_number::TEXT), 1, 8))::BIT(32)::INT) % 3) + 1] AS payment_method,
    average_discount_pct AS discount_pct,
    ROUND((ex_showroom_price * (1 - average_discount_pct / 100.0))::NUMERIC, 2)::NUMERIC(12,2) AS final_sale_price,
    (ARRAY['Walk-in', 'Online', 'Referral', 'Corporate'])[(ABS(('x' || SUBSTRING(MD5('channel' || sale_number::TEXT), 1, 8))::BIT(32)::INT) % 4) + 1] AS sales_channel,
    sale_number
  FROM sales_with_people
),
payment_split AS (
  SELECT
    *,
    CASE
      WHEN payment_method = 'Cash' THEN final_sale_price
      WHEN payment_method = 'Lease' THEN ROUND((final_sale_price * 0.18)::NUMERIC, 2)::NUMERIC(12,2)
      ELSE ROUND((final_sale_price * (0.15 + (ABS(('x' || SUBSTRING(MD5('down' || sale_number::TEXT), 1, 8))::BIT(32)::INT) % 21) / 100.0))::NUMERIC, 2)::NUMERIC(12,2)
    END AS down_payment
  FROM final_sales
)
INSERT INTO customer_sales_data (
  sale_id,
  sale_date,
  month,
  customer_id,
  dealer_id,
  salesperson_id,
  reports_to_id,
  dealer_manager_id,
  regional_manager_id,
  model_id,
  variant_id,
  color,
  customer_age,
  gender,
  profession,
  buyer_type,
  annual_income,
  payment_method,
  down_payment,
  financed_amount,
  discount_pct,
  final_sale_price,
  sales_channel
)
SELECT
  sale_id,
  sale_date,
  month,
  customer_id,
  dealer_id,
  salesperson_id,
  reports_to_id,
  dealer_manager_id,
  regional_manager_id,
  model_id,
  variant_id,
  color,
  customer_age,
  gender,
  profession,
  buyer_type,
  annual_income,
  payment_method,
  down_payment,
  GREATEST(0, final_sale_price - down_payment)::NUMERIC(12,2) AS financed_amount,
  discount_pct,
  final_sale_price,
  sales_channel
FROM payment_split
ON CONFLICT (sale_id) DO UPDATE SET
  sale_date = EXCLUDED.sale_date,
  month = EXCLUDED.month,
  customer_id = EXCLUDED.customer_id,
  dealer_id = EXCLUDED.dealer_id,
  salesperson_id = EXCLUDED.salesperson_id,
  reports_to_id = EXCLUDED.reports_to_id,
  dealer_manager_id = EXCLUDED.dealer_manager_id,
  regional_manager_id = EXCLUDED.regional_manager_id,
  model_id = EXCLUDED.model_id,
  variant_id = EXCLUDED.variant_id,
  color = EXCLUDED.color,
  customer_age = EXCLUDED.customer_age,
  gender = EXCLUDED.gender,
  profession = EXCLUDED.profession,
  buyer_type = EXCLUDED.buyer_type,
  annual_income = EXCLUDED.annual_income,
  payment_method = EXCLUDED.payment_method,
  down_payment = EXCLUDED.down_payment,
  financed_amount = EXCLUDED.financed_amount,
  discount_pct = EXCLUDED.discount_pct,
  final_sale_price = EXCLUDED.final_sale_price,
  sales_channel = EXCLUDED.sales_channel;

COMMIT;
