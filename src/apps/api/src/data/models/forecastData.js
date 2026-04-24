import { pool } from "../../db.js";

export const ForecastData = {
  /**
   * Upserts a batch of forecast rows so reruns refresh existing records in place.
   */
  async insertMany(records, db = pool) {
    if (records.length === 0) {
      return 0;
    }

    const columns = [
      "run_id",
      "forecast_type",
      "level",
      "group_id",
      "group_label",
      "model_id",
      "variant_id",
      "forecast_month",
      "forecast_units",
      "model_method",
      "validation_mae",
      "validation_rmse",
      "validation_mape"
    ];

    const values = [];
    const placeholders = records.map((record, rowIndex) => {
      const offset = rowIndex * columns.length;
      values.push(
        record.runId,
        record.forecastType,
        record.level,
        record.groupId,
        record.groupLabel,
        record.modelId,
        record.variantId,
        record.forecastMonth,
        record.forecastUnits,
        record.modelMethod,
        record.validationMae,
        record.validationRmse,
        record.validationMape
      );

      return `(${columns.map((_column, columnIndex) => `$${offset + columnIndex + 1}`).join(", ")})`;
    });

    await db.query(
      `
        INSERT INTO forecast_data (${columns.join(", ")})
        VALUES ${placeholders.join(", ")}
        ON CONFLICT (forecast_type, level, group_id, model_id, variant_id, forecast_month)
        DO UPDATE SET
          run_id = EXCLUDED.run_id,
          group_label = EXCLUDED.group_label,
          forecast_units = EXCLUDED.forecast_units,
          model_method = EXCLUDED.model_method,
          validation_mae = EXCLUDED.validation_mae,
          validation_rmse = EXCLUDED.validation_rmse,
          validation_mape = EXCLUDED.validation_mape,
          generated_at = NOW()
      `,
      values
    );

    return records.length;
  },

  /**
   * Reads the current key set for a forecast type so stale rows can be removed after refresh.
   */
  async findKeysByForecastType(forecastType = "baseline", db = pool) {
    const result = await db.query(
      `
        SELECT
          forecast_id,
          forecast_type,
          level,
          group_id,
          model_id,
          variant_id,
          TO_CHAR(forecast_month, 'YYYY-MM-01') AS forecast_month
        FROM forecast_data
        WHERE forecast_type = $1
      `,
      [forecastType]
    );

    return result.rows;
  },

  /**
   * Deletes rows that are no longer relevant after the latest forecast refresh.
   */
  async deleteByIds(ids, db = pool) {
    if (ids.length === 0) {
      return 0;
    }

    const result = await db.query(
      `
        DELETE FROM forecast_data
        WHERE forecast_id = ANY($1::BIGINT[])
      `,
      [ids]
    );

    return result.rowCount;
  },

  /**
   * Returns the number of stored forecast rows for a forecast type.
   */
  async countByForecastType(forecastType = "baseline", db = pool) {
    const result = await db.query(
      `
        SELECT COUNT(*)::INTEGER AS count
        FROM forecast_data
        WHERE forecast_type = $1
      `,
      [forecastType]
    );

    return result.rows[0]?.count ?? 0;
  },

  /**
   * Removes all stored forecast rows for a forecast type.
   */
  async clearByForecastType(forecastType = "baseline", db = pool) {
    const result = await db.query(
      `
        DELETE FROM forecast_data
        WHERE forecast_type = $1
      `,
      [forecastType]
    );

    return result.rowCount;
  },

  /**
   * Reads forecast rows from the latest completed run with optional hierarchy filters.
   */
  async findLatest({ level, groupId, segment, modelId, variantId, forecastType = "baseline" }, db = pool) {
    const latestRunId = await findLatestCompletedRunId(forecastType, db);

    if (!latestRunId) {
      return [];
    }

    const exactRows = await findLatestExactRows(
      {
        latestRunId,
        level,
        groupId,
        segment,
        modelId,
        variantId,
        forecastType
      },
      db
    );

    if (exactRows.length > 0 || modelId || variantId) {
      return exactRows;
    }

    return findAllModelAggregateRows(
      {
        latestRunId,
        level,
        groupId,
        segment,
        forecastType
      },
      db
    );
  }
};

async function findLatestCompletedRunId(forecastType, db = pool) {
  const result = await db.query(
    `
      SELECT run_id
      FROM forecast_runs
      WHERE forecast_type = $1
        AND status = 'completed'
      ORDER BY completed_at DESC
      LIMIT 1
    `,
    [forecastType]
  );

  return result.rows[0]?.run_id ?? null;
}

async function findLatestExactRows(
  { latestRunId, level, groupId, segment, modelId, variantId, forecastType },
  db = pool
) {
  const conditions = ["fd.forecast_type = $1"];
  const values = [forecastType, latestRunId];

  if (level) {
    values.push(level);
    conditions.push(`fd.level = $${values.length}`);
  }

  if (groupId) {
    values.push(groupId);
    conditions.push(`fd.group_id = $${values.length}`);
  }

  if (segment && !modelId && !variantId) {
    return [];
  }

  if (modelId) {
    values.push(modelId);
    conditions.push(`fd.model_id = $${values.length}`);
  } else if (!variantId) {
    conditions.push("fd.model_id IS NULL");
  }

  if (variantId) {
    values.push(variantId);
    conditions.push(`fd.variant_id = $${values.length}`);
  } else {
    conditions.push("fd.variant_id IS NULL");
  }

  const result = await db.query(
    `
        SELECT
          fr.run_id,
          fr.horizon_months,
          fr.completed_at,
          fd.level,
          fd.group_id,
          fd.group_label,
          fd.model_id,
          fd.variant_id,
          TO_CHAR(fd.forecast_month, 'YYYY-MM-01') AS forecast_month,
          fd.forecast_units,
          fd.model_method,
          fd.validation_mae,
          fd.validation_rmse,
          fd.validation_mape,
          fd.generated_at
        FROM forecast_data fd
        JOIN forecast_runs fr ON fr.run_id = fd.run_id
        WHERE ${conditions.join(" AND ")}
          AND fd.run_id = $2
          AND fr.status = 'completed'
        ORDER BY fd.level, fd.group_id, fd.forecast_month
      `,
    values
  );

  return result.rows;
}

async function findAllModelAggregateRows({ latestRunId, level, groupId, segment, forecastType }, db = pool) {
  const conditions = [
    "fd.forecast_type = $1",
    "fd.run_id = $2",
    "fd.model_id IS NOT NULL",
    "fd.variant_id IS NULL"
  ];
  const values = [forecastType, latestRunId];

  if (level) {
    values.push(level);
    conditions.push(`fd.level = $${values.length}`);
  }

  if (groupId) {
    values.push(groupId);
    conditions.push(`fd.group_id = $${values.length}`);
  }

  if (segment) {
    values.push(segment);
    conditions.push(`vm.segment = $${values.length}`);
  }

  const result = await db.query(
    `
      SELECT
        fr.run_id,
        fr.horizon_months,
        fr.completed_at,
        fd.level,
        fd.group_id,
        fd.group_label,
        NULL::VARCHAR(16) AS model_id,
        NULL::VARCHAR(16) AS variant_id,
        TO_CHAR(fd.forecast_month, 'YYYY-MM-01') AS forecast_month,
        SUM(fd.forecast_units)::INTEGER AS forecast_units,
        'Aggregated model forecasts' AS model_method,
        NULL::NUMERIC AS validation_mae,
        NULL::NUMERIC AS validation_rmse,
        NULL::NUMERIC AS validation_mape,
        MAX(fd.generated_at) AS generated_at
      FROM forecast_data fd
      JOIN vehicle_models vm ON vm.model_id = fd.model_id
      JOIN forecast_runs fr ON fr.run_id = fd.run_id
      WHERE ${conditions.join(" AND ")}
        AND fr.status = 'completed'
      GROUP BY
        fr.run_id,
        fr.horizon_months,
        fr.completed_at,
        fd.level,
        fd.group_id,
        fd.group_label,
        fd.forecast_month
      ORDER BY fd.level, fd.group_id, fd.forecast_month
    `,
    values
  );

  return result.rows;
}
