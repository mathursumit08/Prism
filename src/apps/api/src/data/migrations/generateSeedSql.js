import fs from "node:fs";
import readline from "node:readline";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../../../../..");
const dataDir = process.env.CSV_DATA_DIR || path.join(repoRoot, "data");
const scriptsDir = path.resolve(__dirname, "../scripts");
const batchSize = Number(process.env.SEED_SQL_BATCH_SIZE || 500);
const customerChunkBytes = Number(process.env.CUSTOMER_SEED_CHUNK_BYTES || 49_000_000);

const csvImports = [
  {
    file: "dealers.csv",
    outputFile: "002_seed_dealers.sql",
    table: "dealers",
    columns: ["dealer_id", "dealer_name", "region", "city", "state", "dealer_type", "sales_capacity_per_month"],
    conflictTarget: ["dealer_id"]
  },
  {
    file: "models.csv",
    outputFile: "003_seed_vehicle_models.sql",
    table: "vehicle_models",
    columns: ["model_id", "model", "manufacturer", "segment", "launch_year"],
    conflictTarget: ["model_id"]
  },
  {
    file: "variants.csv",
    outputFile: "004_seed_vehicle_variants.sql",
    table: "vehicle_variants",
    columns: ["variant_id", "model_id", "variant", "fuel_type", "transmission", "ex_showroom_price"],
    conflictTarget: ["variant_id"]
  },
  {
    file: "sales_personnel.csv",
    outputFile: "005_seed_sales_personnel.sql",
    table: "sales_personnel",
    columns: ["employee_id", "employee_name", "role", "reports_to_id", "dealer_id", "region", "hire_date"],
    conflictTarget: ["employee_id"]
  },
  {
    file: "monthly_sales_data.csv",
    outputFile: "006_seed_monthly_sales_data.sql",
    table: "monthly_sales_data",
    columns: ["month", "dealer_id", "model_id", "variant_id", "units_sold", "stock_available", "inventory_days", "average_discount_pct", "marketing_spend", "test_drives", "enquiries", "active_sales_executives", "dealer_manager_id", "regional_manager_id", "festival_month", "economic_index", "competitor_index"],
    conflictTarget: ["month", "dealer_id", "model_id", "variant_id"]
  },
  {
    file: "stock_data.csv",
    outputFile: "007_seed_stock_data.sql",
    table: "stock_data",
    columns: ["month", "dealer_id", "model_id", "variant_id", "opening_stock", "stock_received", "units_sold", "closing_stock", "inventory_days"],
    conflictTarget: ["month", "dealer_id", "model_id", "variant_id"]
  },
  {
    file: "customer_sales_data.csv",
    outputFilePrefix: "008_seed_customer_sales_data_part_",
    outputFileSuffix: ".sql",
    maxBytes: customerChunkBytes,
    table: "customer_sales_data",
    columns: ["sale_id", "sale_date", "month", "customer_id", "dealer_id", "salesperson_id", "reports_to_id", "dealer_manager_id", "regional_manager_id", "model_id", "variant_id", "color", "customer_age", "gender", "profession", "buyer_type", "annual_income", "payment_method", "down_payment", "financed_amount", "discount_pct", "final_sale_price", "sales_channel"],
    conflictTarget: ["sale_id"]
  }
];

function parseCsvLine(line) {
  const values = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === "," && !inQuotes) {
      values.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  values.push(current);
  return values;
}

function sqlValue(value, column) {
  if (value === "") {
    return "NULL";
  }

  if (column === "festival_month") {
    return value === "1" || value.toLowerCase() === "true" ? "TRUE" : "FALSE";
  }

  return `'${value.replaceAll("'", "''")}'`;
}

function buildInsertSql(config, rows) {
  if (rows.length === 0) {
    return "";
  }

  const updateColumns = config.columns.filter((column) => !config.conflictTarget.includes(column));
  const updateSet = updateColumns.map((column) => `${column} = EXCLUDED.${column}`).join(", ");
  const values = rows
    .map((row) => `  (${config.columns.map((column) => sqlValue(row[column], column)).join(", ")})`)
    .join(",\n");

  return `INSERT INTO ${config.table} (${config.columns.join(", ")})\nVALUES\n${values}\nON CONFLICT (${config.conflictTarget.join(", ")}) DO UPDATE SET ${updateSet};\n\n`;
}

function createSeedWriter(config, partNumber = 1) {
  const outputFile = config.outputFile || `${config.outputFilePrefix}${String(partNumber).padStart(2, "0")}${config.outputFileSuffix}`;
  const outputPath = path.join(scriptsDir, outputFile);
  const output = fs.createWriteStream(outputPath, { encoding: "utf8" });
  const header = `BEGIN;\n\nSET CONSTRAINTS ALL DEFERRED;\n\n-- ${config.file}\n`;

  output.write(header);

  return {
    bytesWritten: Buffer.byteLength(header),
    output,
    outputFile,
    outputPath,
    partNumber,
    rowsWritten: 0
  };
}

async function closeSeedWriter(writer) {
  const footer = "COMMIT;\n";
  writer.output.write(footer);
  writer.bytesWritten += Buffer.byteLength(footer);
  writer.output.end();

  await new Promise((resolve, reject) => {
    writer.output.on("finish", resolve);
    writer.output.on("error", reject);
  });
}

async function writeSeedFiles(config) {
  const filePath = path.join(dataDir, config.file);
  const lines = readline.createInterface({ input: fs.createReadStream(filePath), crlfDelay: Infinity });
  const writtenFiles = [];
  let headers = null;
  let batch = [];
  let rowCount = 0;
  let writer = createSeedWriter(config);

  async function flushBatch() {
    if (batch.length === 0) {
      return;
    }

    const insertSql = buildInsertSql(config, batch);
    const insertBytes = Buffer.byteLength(insertSql);

    if (config.maxBytes && writer.rowsWritten > 0 && writer.bytesWritten + insertBytes + Buffer.byteLength("COMMIT;\n") > config.maxBytes) {
      await closeSeedWriter(writer);
      writtenFiles.push(writer);
      writer = createSeedWriter(config, writer.partNumber + 1);
    }

    writer.output.write(insertSql);
    writer.bytesWritten += insertBytes;
    writer.rowsWritten += batch.length;
    rowCount += batch.length;
    batch = [];
  }

  for await (const line of lines) {
    if (!headers) {
      headers = parseCsvLine(line);
      continue;
    }

    const values = parseCsvLine(line);
    batch.push(Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));

    if (batch.length >= batchSize) {
      await flushBatch();
    }
  }

  await flushBatch();
  await closeSeedWriter(writer);
  writtenFiles.push(writer);

  for (const file of writtenFiles) {
    console.log(`Generated ${file.outputFile} with ${file.rowsWritten} rows (${file.bytesWritten} bytes)`);
  }

  console.log(`Generated inserts for ${rowCount} rows from ${config.file}`);
}

async function removeOldSeedFiles() {
  await fs.promises.mkdir(scriptsDir, { recursive: true });
  const files = await fs.promises.readdir(scriptsDir);
  const generatedSeedPattern = /^00[2-8]_seed_.*\.sql$/;

  await Promise.all(
    files
      .filter((file) => generatedSeedPattern.test(file))
      .map((file) => fs.promises.rm(path.join(scriptsDir, file), { force: true }))
  );
}

async function run() {
  await removeOldSeedFiles();

  for (const config of csvImports) {
    await writeSeedFiles(config);
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
