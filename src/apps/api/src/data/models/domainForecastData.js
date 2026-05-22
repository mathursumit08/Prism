import { pool } from "../../db.js";

const tableConfigs = {
  parts: {
    tableName: "parts_forecast_data",
    unitColumn: "forecast_units",
    columns: [
      "run_id",
      "forecast_type",
      "level",
      "group_id",
      "group_label",
      "part_id",
      "part_category",
      "model_id",
      "variant_id",
      "forecast_month",
      "forecast_units",
      "lower_80",
      "upper_80",
      "lower_95",
      "upper_95",
      "model_method",
      "validation_mae",
      "validation_rmse",
      "validation_mape",
      "data_quality"
    ],
    conflictColumns: ["forecast_type", "level", "group_id", "part_id", "part_category", "model_id", "variant_id", "forecast_month"]
  },
  service: {
    tableName: "service_forecast_data",
    unitColumn: "forecast_orders",
    columns: [
      "run_id",
      "forecast_type",
      "level",
      "group_id",
      "group_label",
      "service_type",
      "job_category",
      "model_id",
      "variant_id",
      "forecast_month",
      "forecast_orders",
      "lower_80",
      "upper_80",
      "lower_95",
      "upper_95",
      "model_method",
      "validation_mae",
      "validation_rmse",
      "validation_mape",
      "data_quality"
    ],
    conflictColumns: ["forecast_type", "level", "group_id", "service_type", "job_category", "model_id", "variant_id", "forecast_month"]
  }
};

function getConfig(domain) {
  const config = tableConfigs[domain];
  if (!config) {
    throw new Error(`Unsupported forecast data domain "${domain}"`);
  }

  return config;
}

function toColumnValue(record, column, unitField) {
  const map = {
    run_id: record.runId,
    forecast_type: record.forecastType,
    level: record.level,
    group_id: record.groupId,
    group_label: record.groupLabel,
    part_id: record.partId,
    part_category: record.partCategory,
    service_type: record.serviceType,
    job_category: record.jobCategory,
    model_id: record.modelId,
    variant_id: record.variantId,
    forecast_month: record.forecastMonth,
    forecast_units: record.forecastUnits,
    forecast_orders: record.forecastOrders,
    lower_80: record.lower80,
    upper_80: record.upper80,
    lower_95: record.lower95,
    upper_95: record.upper95,
    model_method: record.modelMethod,
    validation_mae: record.validationMae,
    validation_rmse: record.validationRmse,
    validation_mape: record.validationMape,
    data_quality: record.dataQuality ?? "rich"
  };

  if (column === unitField && map[column] === undefined) {
    return record.forecastUnits ?? record.forecastOrders;
  }

  return map[column] ?? null;
}

export const DomainForecastData = {
  async insertMany(domain, records, db = pool) {
    if (records.length === 0) {
      return 0;
    }

    const config = getConfig(domain);
    const values = [];
    const placeholders = records.map((record, rowIndex) => {
      const offset = rowIndex * config.columns.length;
      config.columns.forEach((column) => values.push(toColumnValue(record, column, config.unitColumn)));

      return `(${config.columns.map((_column, columnIndex) => `$${offset + columnIndex + 1}`).join(", ")})`;
    });
    const updateColumns = config.columns.filter((column) => !config.conflictColumns.includes(column));
    const updateSet = updateColumns.map((column) => `${column} = EXCLUDED.${column}`).join(", ");

    await db.query(
      `
        INSERT INTO ${config.tableName} (${config.columns.join(", ")})
        VALUES ${placeholders.join(", ")}
        ON CONFLICT (${config.conflictColumns.join(", ")})
        DO UPDATE SET
          ${updateSet},
          generated_at = NOW()
      `,
      values
    );

    return records.length;
  },

  async count(domain, forecastType, db = pool) {
    const config = getConfig(domain);
    const result = await db.query(
      `
        SELECT COUNT(*)::INTEGER AS count
        FROM ${config.tableName}
        WHERE forecast_type = $1
      `,
      [forecastType]
    );

    return result.rows[0]?.count ?? 0;
  },

  async clearFuture(domain, forecastType, db = pool) {
    const config = getConfig(domain);
    const sourceTable = domain === "parts" ? "monthly_service_parts_demand" : "monthly_service_order_volume";
    const monthColumn = "month";
    const result = await db.query(
      `
        DELETE FROM ${config.tableName} fd
        WHERE fd.forecast_type = $1
          AND NOT EXISTS (
            SELECT 1
            FROM ${sourceTable} source
            WHERE source.${monthColumn} = fd.forecast_month
          )
      `,
      [forecastType]
    );

    return result.rowCount;
  }
};
