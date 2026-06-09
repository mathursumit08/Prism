-- Utility script for generating sample monthly actuals for a closed month.
--
-- Usage:
--   1. Run this file once to create or replace the helper function.
--   2. Execute one of the calls below:
--
--      SELECT * FROM generate_sample_monthly_actuals(DATE '2026-05-01');
--      SELECT * FROM generate_sample_monthly_actuals(DATE '2026-05-01', DATE '2026-04-01');
--      SELECT * FROM generate_sample_monthly_actuals(DATE '2026-05-01', NULL, TRUE);
--
-- Arguments:
--   p_target_month      Month to generate, normalized to first day of month.
--   p_source_month      Optional source month. When NULL, each table uses its
--                       latest month before p_target_month.
--   p_replace_existing  When TRUE, clears existing rows for p_target_month
--                       before generating new rows.

CREATE OR REPLACE FUNCTION generate_sample_monthly_actuals(
  p_target_month DATE,
  p_source_month DATE DEFAULT NULL,
  p_replace_existing BOOLEAN DEFAULT FALSE
)
RETURNS TABLE(step_name TEXT, affected_rows INTEGER)
LANGUAGE plpgsql
AS $$
DECLARE
  v_target_month DATE := DATE_TRUNC('month', p_target_month)::DATE;
  v_source_month DATE := CASE
    WHEN p_source_month IS NULL THEN NULL
    ELSE DATE_TRUNC('month', p_source_month)::DATE
  END;
  v_sales_factor NUMERIC;
  v_aftersales_factor NUMERIC;
  v_rows INTEGER;
BEGIN
  IF p_target_month IS NULL THEN
    RAISE EXCEPTION 'p_target_month is required';
  END IF;

  v_sales_factor := CASE
    WHEN EXTRACT(MONTH FROM v_target_month)::INTEGER IN (10, 11) THEN 1.18
    WHEN EXTRACT(MONTH FROM v_target_month)::INTEGER IN (4, 5) THEN 1.08
    WHEN EXTRACT(MONTH FROM v_target_month)::INTEGER IN (7, 8) THEN 0.94
    ELSE 1.02
  END;

  v_aftersales_factor := CASE
    WHEN EXTRACT(MONTH FROM v_target_month)::INTEGER IN (4, 5) THEN 1.08
    WHEN EXTRACT(MONTH FROM v_target_month)::INTEGER IN (10, 11) THEN 1.12
    WHEN EXTRACT(MONTH FROM v_target_month)::INTEGER IN (7, 8) THEN 0.96
    ELSE 1.01
  END;

  IF p_replace_existing THEN
    DELETE FROM monthly_sla_performance WHERE month = v_target_month;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RETURN QUERY SELECT 'monthly_sla_performance cleared'::TEXT, v_rows;

    DELETE FROM monthly_warranty_return_volume WHERE month = v_target_month;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RETURN QUERY SELECT 'monthly_warranty_return_volume cleared'::TEXT, v_rows;

    DELETE FROM monthly_service_order_volume WHERE month = v_target_month;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RETURN QUERY SELECT 'monthly_service_order_volume cleared'::TEXT, v_rows;

    DELETE FROM monthly_service_parts_demand WHERE month = v_target_month;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RETURN QUERY SELECT 'monthly_service_parts_demand cleared'::TEXT, v_rows;

    DELETE FROM stock_data WHERE month = v_target_month;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RETURN QUERY SELECT 'stock_data cleared'::TEXT, v_rows;

    DELETE FROM monthly_sales_data WHERE month = v_target_month;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RETURN QUERY SELECT 'monthly_sales_data cleared'::TEXT, v_rows;
  END IF;

  WITH source_month AS (
    SELECT COALESCE(v_source_month, MAX(month)) AS month
    FROM monthly_sales_data
    WHERE month < v_target_month
  ),
  source_rows AS (
    SELECT
      m.*,
      ROW_NUMBER() OVER (ORDER BY m.dealer_id, m.model_id, m.variant_id) AS rn
    FROM monthly_sales_data m
    JOIN source_month sm ON sm.month = m.month
    JOIN dealers d ON d.dealer_id = m.dealer_id AND d.is_active = TRUE
    JOIN vehicle_models vm ON vm.model_id = m.model_id AND vm.is_active = TRUE AND vm.is_discontinued = FALSE
    JOIN vehicle_variants vv ON vv.variant_id = m.variant_id AND vv.is_active = TRUE AND vv.is_discontinued = FALSE
  ),
  generated AS (
    SELECT
      v_target_month AS month,
      dealer_id,
      model_id,
      variant_id,
      GREATEST(0, ROUND(units_sold * (v_sales_factor + ((((rn * 37) % 21) - 10)::NUMERIC / 100))))::INTEGER AS units_sold,
      GREATEST(0, ROUND(stock_available * (0.96 + ((((rn * 19) % 15) - 7)::NUMERIC / 100))))::INTEGER AS stock_available,
      GREATEST(0, ROUND((inventory_days * (0.98 + ((((rn * 11) % 11) - 5)::NUMERIC / 100)))::NUMERIC, 2)) AS inventory_days,
      LEAST(20, GREATEST(0, ROUND((average_discount_pct + ((((rn * 13) % 9) - 4)::NUMERIC / 10))::NUMERIC, 2))) AS average_discount_pct,
      GREATEST(0, ROUND(marketing_spend * (v_sales_factor + ((((rn * 23) % 15) - 7)::NUMERIC / 100)), 2)) AS marketing_spend,
      GREATEST(0, ROUND(test_drives * (v_sales_factor + ((((rn * 29) % 17) - 8)::NUMERIC / 100))))::INTEGER AS test_drives,
      GREATEST(0, ROUND(enquiries * (v_sales_factor + ((((rn * 31) % 17) - 8)::NUMERIC / 100))))::INTEGER AS enquiries,
      active_sales_executives,
      dealer_manager_id,
      regional_manager_id,
      EXTRACT(MONTH FROM v_target_month)::INTEGER IN (10, 11) AS festival_month,
      ROUND((economic_index + 0.35 + ((((rn * 7) % 7) - 3)::NUMERIC / 10))::NUMERIC, 2) AS economic_index,
      ROUND((competitor_index + ((((rn * 5) % 7) - 3)::NUMERIC / 10))::NUMERIC, 2) AS competitor_index
    FROM source_rows
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
  FROM generated
  ON CONFLICT (month, dealer_id, model_id, variant_id) DO UPDATE SET
    units_sold = EXCLUDED.units_sold,
    stock_available = EXCLUDED.stock_available,
    inventory_days = EXCLUDED.inventory_days,
    average_discount_pct = EXCLUDED.average_discount_pct,
    marketing_spend = EXCLUDED.marketing_spend,
    test_drives = EXCLUDED.test_drives,
    enquiries = EXCLUDED.enquiries,
    active_sales_executives = EXCLUDED.active_sales_executives,
    dealer_manager_id = EXCLUDED.dealer_manager_id,
    regional_manager_id = EXCLUDED.regional_manager_id,
    festival_month = EXCLUDED.festival_month,
    economic_index = EXCLUDED.economic_index,
    competitor_index = EXCLUDED.competitor_index;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN QUERY SELECT 'monthly_sales_data'::TEXT, v_rows;

  WITH source_month AS (
    SELECT COALESCE(v_source_month, MAX(month)) AS month
    FROM stock_data
    WHERE month < v_target_month
  ),
  source_rows AS (
    SELECT
      s.*,
      COALESCE(msd.units_sold, s.units_sold) AS generated_units_sold,
      ROW_NUMBER() OVER (ORDER BY s.dealer_id, s.model_id, s.variant_id) AS rn
    FROM stock_data s
    JOIN source_month sm ON sm.month = s.month
    JOIN monthly_sales_data msd
      ON msd.month = v_target_month
     AND msd.dealer_id = s.dealer_id
     AND msd.model_id = s.model_id
     AND msd.variant_id = s.variant_id
    JOIN dealers d ON d.dealer_id = s.dealer_id AND d.is_active = TRUE
    JOIN vehicle_models vm ON vm.model_id = s.model_id AND vm.is_active = TRUE AND vm.is_discontinued = FALSE
    JOIN vehicle_variants vv ON vv.variant_id = s.variant_id AND vv.is_active = TRUE AND vv.is_discontinued = FALSE
  ),
  generated AS (
    SELECT
      v_target_month AS month,
      dealer_id,
      model_id,
      variant_id,
      closing_stock AS opening_stock,
      GREATEST(0, ROUND((generated_units_sold + closing_stock * 0.18) * (0.92 + ((((rn * 17) % 15) - 7)::NUMERIC / 100))))::INTEGER AS stock_received,
      generated_units_sold AS units_sold,
      GREATEST(0, closing_stock + GREATEST(0, ROUND((generated_units_sold + closing_stock * 0.18) * (0.92 + ((((rn * 17) % 15) - 7)::NUMERIC / 100))))::INTEGER - generated_units_sold) AS closing_stock,
      GREATEST(0, ROUND((inventory_days * (0.98 + ((((rn * 11) % 11) - 5)::NUMERIC / 100)))::NUMERIC, 2)) AS inventory_days
    FROM source_rows
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
    stock_received,
    units_sold,
    closing_stock,
    inventory_days
  FROM generated
  ON CONFLICT (month, dealer_id, model_id, variant_id) DO UPDATE SET
    opening_stock = EXCLUDED.opening_stock,
    stock_received = EXCLUDED.stock_received,
    units_sold = EXCLUDED.units_sold,
    closing_stock = EXCLUDED.closing_stock,
    inventory_days = EXCLUDED.inventory_days;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN QUERY SELECT 'stock_data'::TEXT, v_rows;

  WITH source_month AS (
    SELECT COALESCE(v_source_month, MAX(month)) AS month
    FROM monthly_service_parts_demand
    WHERE month < v_target_month
  ),
  source_rows AS (
    SELECT
      msd.*,
      ROW_NUMBER() OVER (ORDER BY msd.service_center_id, msd.part_id, msd.model_id, msd.variant_id) AS rn
    FROM monthly_service_parts_demand msd
    JOIN source_month sm ON sm.month = msd.month
    JOIN service_centers sc ON sc.service_center_id = msd.service_center_id AND sc.is_active = TRUE
    JOIN service_parts sp ON sp.part_id = msd.part_id AND sp.is_active = TRUE
  ),
  base AS (
    SELECT
      v_target_month AS month,
      service_center_id,
      part_id,
      model_id,
      variant_id,
      GREATEST(0, ROUND(quantity_demanded * (v_aftersales_factor + ((((rn * 37) % 23) - 11)::NUMERIC / 100))))::INTEGER AS quantity_demanded,
      quantity_fulfilled,
      quantity_backordered,
      lost_sales_quantity,
      opening_stock,
      stock_received,
      closing_stock,
      stockout_days,
      average_lead_time_days,
      warranty_quantity,
      paid_quantity,
      rn
    FROM source_rows
  ),
  generated AS (
    SELECT
      month,
      service_center_id,
      part_id,
      model_id,
      variant_id,
      quantity_demanded,
      LEAST(quantity_demanded, GREATEST(0, ROUND(quantity_fulfilled * (v_aftersales_factor + ((((rn * 19) % 15) - 7)::NUMERIC / 100))))::INTEGER) AS quantity_fulfilled,
      LEAST(quantity_demanded, GREATEST(0, ROUND(quantity_backordered * (v_aftersales_factor + ((((rn * 13) % 11) - 5)::NUMERIC / 100))))::INTEGER) AS quantity_backordered,
      LEAST(quantity_demanded, GREATEST(0, ROUND(lost_sales_quantity * (v_aftersales_factor + ((((rn * 7) % 9) - 4)::NUMERIC / 100))))::INTEGER) AS lost_sales_quantity,
      GREATEST(0, closing_stock) AS opening_stock,
      GREATEST(0, ROUND((quantity_demanded + closing_stock * 0.20) * (0.90 + ((((rn * 23) % 15) - 7)::NUMERIC / 100))))::INTEGER AS stock_received,
      GREATEST(0, closing_stock + GREATEST(0, ROUND((quantity_demanded + closing_stock * 0.20) * (0.90 + ((((rn * 23) % 15) - 7)::NUMERIC / 100))))::INTEGER - quantity_demanded) AS closing_stock,
      CASE WHEN quantity_demanded > quantity_fulfilled THEN LEAST(8, stockout_days + 1) ELSE GREATEST(0, stockout_days - 1) END AS stockout_days,
      GREATEST(0, ROUND((average_lead_time_days * (0.98 + ((((rn * 11) % 9) - 4)::NUMERIC / 100)))::NUMERIC, 2)) AS average_lead_time_days,
      LEAST(quantity_demanded, GREATEST(0, ROUND(warranty_quantity * (v_aftersales_factor + ((((rn * 17) % 13) - 6)::NUMERIC / 100))))::INTEGER) AS warranty_quantity,
      LEAST(quantity_demanded, GREATEST(0, ROUND(paid_quantity * (v_aftersales_factor + ((((rn * 29) % 13) - 6)::NUMERIC / 100))))::INTEGER) AS paid_quantity
    FROM base
  )
  INSERT INTO monthly_service_parts_demand (
    month,
    service_center_id,
    part_id,
    model_id,
    variant_id,
    quantity_demanded,
    quantity_fulfilled,
    quantity_backordered,
    lost_sales_quantity,
    opening_stock,
    stock_received,
    closing_stock,
    stockout_days,
    average_lead_time_days,
    warranty_quantity,
    paid_quantity
  )
  SELECT
    month,
    service_center_id,
    part_id,
    model_id,
    variant_id,
    quantity_demanded,
    quantity_fulfilled,
    quantity_backordered,
    lost_sales_quantity,
    opening_stock,
    stock_received,
    closing_stock,
    stockout_days,
    average_lead_time_days,
    warranty_quantity,
    paid_quantity
  FROM generated
  ON CONFLICT (month, service_center_id, part_id, model_id, variant_id) DO UPDATE SET
    quantity_demanded = EXCLUDED.quantity_demanded,
    quantity_fulfilled = EXCLUDED.quantity_fulfilled,
    quantity_backordered = EXCLUDED.quantity_backordered,
    lost_sales_quantity = EXCLUDED.lost_sales_quantity,
    opening_stock = EXCLUDED.opening_stock,
    stock_received = EXCLUDED.stock_received,
    closing_stock = EXCLUDED.closing_stock,
    stockout_days = EXCLUDED.stockout_days,
    average_lead_time_days = EXCLUDED.average_lead_time_days,
    warranty_quantity = EXCLUDED.warranty_quantity,
    paid_quantity = EXCLUDED.paid_quantity;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN QUERY SELECT 'monthly_service_parts_demand'::TEXT, v_rows;

  WITH source_month AS (
    SELECT COALESCE(v_source_month, MAX(month)) AS month
    FROM monthly_service_order_volume
    WHERE month < v_target_month
  ),
  source_rows AS (
    SELECT
      mov.*,
      ROW_NUMBER() OVER (ORDER BY mov.service_center_id, mov.service_type, mov.job_category, mov.model_id, mov.variant_id) AS rn
    FROM monthly_service_order_volume mov
    JOIN source_month sm ON sm.month = mov.month
    JOIN service_centers sc ON sc.service_center_id = mov.service_center_id AND sc.is_active = TRUE
  ),
  base AS (
    SELECT
      v_target_month AS month,
      service_center_id,
      service_type,
      job_category,
      model_id,
      variant_id,
      GREATEST(0, ROUND(order_count * (v_aftersales_factor + ((((rn * 31) % 23) - 11)::NUMERIC / 100))))::INTEGER AS order_count,
      completed_count,
      cancelled_count,
      warranty_count,
      repeat_repair_count,
      available_technicians,
      available_bays,
      working_days,
      rn
    FROM source_rows
  ),
  generated AS (
    SELECT
      month,
      service_center_id,
      service_type,
      job_category,
      model_id,
      variant_id,
      order_count,
      LEAST(order_count, GREATEST(0, ROUND(completed_count * (v_aftersales_factor + ((((rn * 17) % 15) - 7)::NUMERIC / 100))))::INTEGER) AS completed_count,
      LEAST(order_count, GREATEST(0, ROUND(cancelled_count * (v_aftersales_factor + ((((rn * 11) % 9) - 4)::NUMERIC / 100))))::INTEGER) AS cancelled_count,
      LEAST(order_count, GREATEST(0, ROUND(warranty_count * (v_aftersales_factor + ((((rn * 13) % 11) - 5)::NUMERIC / 100))))::INTEGER) AS warranty_count,
      LEAST(order_count, GREATEST(0, ROUND(repeat_repair_count * (v_aftersales_factor + ((((rn * 7) % 9) - 4)::NUMERIC / 100))))::INTEGER) AS repeat_repair_count,
      available_technicians,
      available_bays,
      working_days
    FROM base
  )
  INSERT INTO monthly_service_order_volume (
    month,
    service_center_id,
    service_type,
    job_category,
    model_id,
    variant_id,
    order_count,
    completed_count,
    cancelled_count,
    warranty_count,
    repeat_repair_count,
    available_technicians,
    available_bays,
    working_days
  )
  SELECT
    month,
    service_center_id,
    service_type,
    job_category,
    model_id,
    variant_id,
    order_count,
    completed_count,
    cancelled_count,
    warranty_count,
    repeat_repair_count,
    available_technicians,
    available_bays,
    working_days
  FROM generated
  ON CONFLICT (month, service_center_id, service_type, job_category, model_id, variant_id) DO UPDATE SET
    order_count = EXCLUDED.order_count,
    completed_count = EXCLUDED.completed_count,
    cancelled_count = EXCLUDED.cancelled_count,
    warranty_count = EXCLUDED.warranty_count,
    repeat_repair_count = EXCLUDED.repeat_repair_count,
    available_technicians = EXCLUDED.available_technicians,
    available_bays = EXCLUDED.available_bays,
    working_days = EXCLUDED.working_days;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN QUERY SELECT 'monthly_service_order_volume'::TEXT, v_rows;

  WITH source_month AS (
    SELECT COALESCE(v_source_month, MAX(month)) AS month
    FROM monthly_warranty_return_volume
    WHERE month < v_target_month
  ),
  source_rows AS (
    SELECT
      mwv.*,
      ROW_NUMBER() OVER (ORDER BY mwv.service_center_id, mwv.claim_type, mwv.return_reason, mwv.age_bucket, mwv.model_id, mwv.variant_id) AS rn
    FROM monthly_warranty_return_volume mwv
    JOIN source_month sm ON sm.month = mwv.month
    JOIN service_centers sc ON sc.service_center_id = mwv.service_center_id AND sc.is_active = TRUE
  ),
  generated AS (
    SELECT
      v_target_month AS month,
      service_center_id,
      claim_type,
      return_reason,
      age_bucket,
      model_id,
      variant_id,
      GREATEST(0, ROUND(claim_count * (v_aftersales_factor + ((((rn * 31) % 19) - 9)::NUMERIC / 100))))::INTEGER AS claim_count,
      GREATEST(0, ROUND(return_count * (v_aftersales_factor + ((((rn * 17) % 15) - 7)::NUMERIC / 100))))::INTEGER AS return_count,
      GREATEST(0, ROUND(claim_amount * (v_aftersales_factor + ((((rn * 13) % 11) - 5)::NUMERIC / 100)), 2)) AS claim_amount,
      GREATEST(0, ROUND(return_amount * (v_aftersales_factor + ((((rn * 11) % 11) - 5)::NUMERIC / 100)), 2)) AS return_amount
    FROM source_rows
  )
  INSERT INTO monthly_warranty_return_volume (
    month,
    service_center_id,
    claim_type,
    return_reason,
    age_bucket,
    model_id,
    variant_id,
    claim_count,
    return_count,
    claim_amount,
    return_amount
  )
  SELECT
    month,
    service_center_id,
    claim_type,
    return_reason,
    age_bucket,
    model_id,
    variant_id,
    claim_count,
    return_count,
    claim_amount,
    return_amount
  FROM generated
  ON CONFLICT (month, service_center_id, claim_type, return_reason, age_bucket, model_id, variant_id) DO UPDATE SET
    claim_count = EXCLUDED.claim_count,
    return_count = EXCLUDED.return_count,
    claim_amount = EXCLUDED.claim_amount,
    return_amount = EXCLUDED.return_amount;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN QUERY SELECT 'monthly_warranty_return_volume'::TEXT, v_rows;

  DELETE FROM monthly_sla_performance WHERE month = v_target_month;

  INSERT INTO monthly_sla_performance (
    month,
    service_center_id,
    service_type,
    job_category,
    model_id,
    variant_id,
    total_orders,
    completed_orders,
    breached_orders,
    sla_target_hours,
    avg_resolution_hours,
    p90_resolution_hours,
    backlog_open_orders,
    parts_wait_orders,
    repeat_repair_orders,
    cancelled_orders
  )
  SELECT
    mov.month,
    mov.service_center_id,
    mov.service_type,
    mov.job_category,
    NULL::VARCHAR AS model_id,
    NULL::VARCHAR AS variant_id,
    SUM(mov.order_count)::INTEGER AS total_orders,
    SUM(mov.completed_count)::INTEGER AS completed_orders,
    LEAST(
      SUM(mov.order_count)::INTEGER,
      GREATEST(
        0,
        ROUND(
          SUM(mov.order_count) * (
            0.045
            + CASE WHEN mov.service_type ILIKE '%Repair%' THEN 0.035 ELSE 0 END
            + CASE WHEN mov.job_category ILIKE '%Engine%' OR mov.job_category ILIKE '%Electrical%' THEN 0.03 ELSE 0 END
            + CASE WHEN mov.job_category ILIKE '%Body%' THEN 0.02 ELSE 0 END
            + (SUM(mov.repeat_repair_count)::NUMERIC / NULLIF(SUM(mov.order_count), 0)) * 0.30
          )
        )::INTEGER
      )
    ) AS breached_orders,
    CASE
      WHEN mov.service_type ILIKE '%Express%' THEN 24
      WHEN mov.job_category ILIKE '%Body%' THEN 96
      WHEN mov.job_category ILIKE '%Engine%' OR mov.job_category ILIKE '%Electrical%' THEN 72
      ELSE 48
    END::NUMERIC AS sla_target_hours,
    ROUND(
      CASE
        WHEN mov.service_type ILIKE '%Express%' THEN 18
        WHEN mov.job_category ILIKE '%Body%' THEN 80
        WHEN mov.job_category ILIKE '%Engine%' OR mov.job_category ILIKE '%Electrical%' THEN 58
        ELSE 36
      END
      + (SUM(mov.order_count)::NUMERIC / NULLIF(MAX(sc.service_capacity_per_day) * GREATEST(MAX(mov.working_days), 1), 0)) * 16,
      2
    ) AS avg_resolution_hours,
    ROUND(
      CASE
        WHEN mov.service_type ILIKE '%Express%' THEN 30
        WHEN mov.job_category ILIKE '%Body%' THEN 122
        WHEN mov.job_category ILIKE '%Engine%' OR mov.job_category ILIKE '%Electrical%' THEN 96
        ELSE 64
      END
      + (SUM(mov.order_count)::NUMERIC / NULLIF(MAX(sc.service_capacity_per_day) * GREATEST(MAX(mov.working_days), 1), 0)) * 24,
      2
    ) AS p90_resolution_hours,
    GREATEST(0, SUM(mov.order_count - mov.completed_count - mov.cancelled_count))::INTEGER AS backlog_open_orders,
    ROUND(SUM(mov.order_count) * CASE WHEN mov.job_category ILIKE '%Engine%' OR mov.job_category ILIKE '%Electrical%' THEN 0.12 ELSE 0.06 END)::INTEGER AS parts_wait_orders,
    SUM(mov.repeat_repair_count)::INTEGER AS repeat_repair_orders,
    SUM(mov.cancelled_count)::INTEGER AS cancelled_orders
  FROM monthly_service_order_volume mov
  JOIN service_centers sc ON sc.service_center_id = mov.service_center_id
  WHERE mov.month = v_target_month
  GROUP BY mov.month, mov.service_center_id, mov.service_type, mov.job_category;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN QUERY SELECT 'monthly_sla_performance'::TEXT, v_rows;

  RETURN;
END;
$$;
