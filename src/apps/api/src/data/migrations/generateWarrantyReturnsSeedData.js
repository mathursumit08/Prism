import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../../../../..");
const dataDir = path.join(repoRoot, "data");
const scriptsDir = path.resolve(__dirname, "../scripts");
const batchSize = 500;
const maxSeedBytes = 46 * 1024 * 1024;
const months = buildMonths("2024-04-01", "2026-05-01");
const claimTypes = ["Standard Warranty", "Extended Warranty", "Goodwill", "Recall"];
const claimCategories = ["Powertrain", "Electrical", "Infotainment", "HVAC", "Body", "Battery", "Software"];
const returnReasons = ["Quality Concern", "Incorrect Variant", "Transit Damage", "Documentation Issue", "Customer Cancellation", "Exchange"];
const ageBuckets = ["0-3m", "4-6m", "7-12m", "13-24m", "25-36m"];
const statuses = ["Approved", "Approved", "Approved", "Submitted", "Rejected", "Paid"];

function buildMonths(startMonth, endMonth) {
  const output = [];
  let cursor = new Date(`${startMonth}T00:00:00.000Z`);
  const end = new Date(`${endMonth}T00:00:00.000Z`);
  while (cursor <= end) {
    output.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return output;
}

function mulberry32(seed) {
  let state = seed;
  return () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

const random = mulberry32(20260526);
const pick = (values) => values[Math.floor(random() * values.length)];
const pad = (value, length) => String(value).padStart(length, "0");

function monthEndDay(month) {
  const date = new Date(`${month}T00:00:00.000Z`);
  date.setUTCMonth(date.getUTCMonth() + 1);
  date.setUTCDate(0);
  return date.getUTCDate();
}

function seasonalFactor(month) {
  const monthNumber = Number(month.slice(5, 7));
  if ([10, 11].includes(monthNumber)) return 1.16;
  if ([4, 5].includes(monthNumber)) return 1.08;
  if ([7, 8].includes(monthNumber)) return 0.94;
  return 1;
}

function trendFactor(month) {
  return 0.9 + months.indexOf(month) * 0.009;
}

function splitCsvLine(line) {
  const values = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (quoted && character === '"' && line[index + 1] === '"') {
      current += '"';
      index += 1;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (character === "," && !quoted) {
      values.push(current);
      current = "";
    } else {
      current += character;
    }
  }
  values.push(current);
  return values;
}

function parseCsv(fileName) {
  const text = fs.readFileSync(path.join(dataDir, fileName), "utf8").trim();
  const [headerLine, ...lines] = text.split(/\r?\n/);
  const headers = headerLine.split(",");
  return lines.map((line) => {
    const values = splitCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
  });
}

function csvEscape(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function writeCsv(fileName, rows) {
  const headers = Object.keys(rows[0] ?? {});
  const csv = [headers.join(","), ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(","))].join("\n") + "\n";
  fs.writeFileSync(path.join(dataDir, fileName), csv, "utf8");
}

function sqlValue(value) {
  if (value === "" || value === null || value === undefined) return "NULL";
  if (value === true || value === "true") return "TRUE";
  if (value === false || value === "false") return "FALSE";
  return `'${String(value).replaceAll("'", "''")}'`;
}

function buildInsertSql(config, rows) {
  const values = rows.map((row) => `  (${config.columns.map((column) => sqlValue(row[column])).join(", ")})`).join(",\n");
  const updateColumns = config.columns.filter((column) => !config.conflictTarget.includes(column));
  const updateSet = updateColumns.map((column) => `${column} = EXCLUDED.${column}`).join(", ");
  return `INSERT INTO ${config.table} (${config.columns.join(", ")})\nVALUES\n${values}\nON CONFLICT (${config.conflictTarget.join(", ")}) DO UPDATE SET ${updateSet};\n\n`;
}

function writeSeedSql(config, rows) {
  let part = 1;
  let bytes = 0;
  let sql = "";
  const files = [];
  const reset = () => {
    sql = `BEGIN;\n\nSET CONSTRAINTS ALL DEFERRED;\n\n-- ${config.csvFile}\n`;
    bytes = Buffer.byteLength(sql);
  };
  const fileName = () => `${config.outputFilePrefix}${pad(part, 2)}.sql`;
  const flush = () => {
    sql += "COMMIT;\n";
    const outputFile = fileName();
    fs.writeFileSync(path.join(scriptsDir, outputFile), sql, "utf8");
    files.push({ outputFile, bytes: Buffer.byteLength(sql) });
    part += 1;
    reset();
  };
  reset();
  for (let index = 0; index < rows.length; index += batchSize) {
    const insertSql = buildInsertSql(config, rows.slice(index, index + batchSize));
    const hasRows = bytes > Buffer.byteLength("BEGIN;\n\nSET CONSTRAINTS ALL DEFERRED;\n\n");
    if (hasRows && bytes + Buffer.byteLength(insertSql) + Buffer.byteLength("COMMIT;\n") > maxSeedBytes) {
      flush();
    }
    sql += insertSql;
    bytes += Buffer.byteLength(insertSql);
  }
  flush();
  return files;
}

function vehicleAgeForBucket(bucket) {
  if (bucket === "0-3m") return Math.floor(random() * 4);
  if (bucket === "4-6m") return 4 + Math.floor(random() * 3);
  if (bucket === "7-12m") return 7 + Math.floor(random() * 6);
  if (bucket === "13-24m") return 13 + Math.floor(random() * 12);
  return 25 + Math.floor(random() * 12);
}

function buildData(centers) {
  const claims = [];
  const returns = [];
  const volume = new Map();
  let claimNumber = 1;
  let returnNumber = 1;

  for (const center of centers) {
    for (const month of months) {
      const centerScale = center.center_type === "Metro" ? 1.35 : center.center_type === "Urban" ? 1 : 0.72;
      const claimVolume = Math.round((18 + random() * 18) * centerScale * seasonalFactor(month) * trendFactor(month));
      const returnVolume = Math.round((3 + random() * 7) * centerScale * seasonalFactor(month) * trendFactor(month));

      for (let index = 0; index < claimVolume; index += 1) {
        const variantNumber = ((index + months.indexOf(month) + Number(center.service_center_id.slice(3))) % 72) + 1;
        const modelNumber = Math.floor((variantNumber - 1) / 6) + 1;
        const ageBucket = pick(ageBuckets);
        const row = {
          claim_id: `WCL${pad(claimNumber++, 8)}`,
          claim_date: `${month.slice(0, 8)}${pad(1 + Math.floor(random() * monthEndDay(month)), 2)}`,
          month,
          service_center_id: center.service_center_id,
          model_id: `MDL${pad(modelNumber, 3)}`,
          variant_id: `VAR${pad(variantNumber, 3)}`,
          claim_type: pick(claimTypes),
          claim_category: pick(claimCategories),
          age_bucket: ageBucket,
          vehicle_age_months: vehicleAgeForBucket(ageBucket),
          claim_count: 1,
          claim_amount: Math.round(1800 + random() * 42000),
          status: pick(statuses)
        };
        claims.push(row);
        addVolume(volume, row, null);
      }

      for (let index = 0; index < returnVolume; index += 1) {
        const variantNumber = ((index * 3 + months.indexOf(month) + Number(center.service_center_id.slice(3))) % 72) + 1;
        const modelNumber = Math.floor((variantNumber - 1) / 6) + 1;
        const ageBucket = pick(ageBuckets.slice(0, 3));
        const row = {
          return_id: `RET${pad(returnNumber++, 8)}`,
          return_date: `${month.slice(0, 8)}${pad(1 + Math.floor(random() * monthEndDay(month)), 2)}`,
          month,
          service_center_id: center.service_center_id,
          model_id: `MDL${pad(modelNumber, 3)}`,
          variant_id: `VAR${pad(variantNumber, 3)}`,
          return_reason: pick(returnReasons),
          age_bucket: ageBucket,
          vehicle_age_months: vehicleAgeForBucket(ageBucket),
          return_count: 1,
          return_amount: Math.round(25000 + random() * 420000),
          status: pick(["Approved", "Approved", "Submitted", "Rejected", "Closed"])
        };
        returns.push(row);
        addVolume(volume, null, row);
      }
    }
  }

  return {
    claims,
    returns,
    monthly: [...volume.values()].sort((left, right) =>
      [left.month, left.service_center_id, left.claim_type, left.return_reason, left.age_bucket, left.model_id, left.variant_id]
        .join("|")
        .localeCompare([right.month, right.service_center_id, right.claim_type, right.return_reason, right.age_bucket, right.model_id, right.variant_id].join("|"))
    )
  };
}

function addVolume(groups, claim, productReturn) {
  const source = claim || productReturn;
  const key = [
    source.month,
    source.service_center_id,
    claim?.claim_type ?? "No Claim",
    productReturn?.return_reason ?? "No Return",
    source.age_bucket,
    source.model_id,
    source.variant_id
  ].join("|");
  if (!groups.has(key)) {
    groups.set(key, {
      month: source.month,
      service_center_id: source.service_center_id,
      claim_type: claim?.claim_type ?? "No Claim",
      return_reason: productReturn?.return_reason ?? "No Return",
      age_bucket: source.age_bucket,
      model_id: source.model_id,
      variant_id: source.variant_id,
      claim_count: 0,
      return_count: 0,
      claim_amount: 0,
      return_amount: 0
    });
  }
  const group = groups.get(key);
  group.claim_count += claim ? claim.claim_count : 0;
  group.return_count += productReturn ? productReturn.return_count : 0;
  group.claim_amount += claim ? claim.claim_amount : 0;
  group.return_amount += productReturn ? productReturn.return_amount : 0;
}

fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(scriptsDir, { recursive: true });

const centers = parseCsv("service_centers.csv").filter((center) => center.is_active !== "false");
const { claims, returns, monthly } = buildData(centers);

writeCsv("warranty_claims_apr2024_may2026.csv", claims);
writeCsv("product_returns_apr2024_may2026.csv", returns);
writeCsv("monthly_warranty_return_volume_apr2024_may2026.csv", monthly);

const configs = [
  {
    csvFile: "warranty_claims_apr2024_may2026.csv",
    outputFilePrefix: "040_seed_warranty_claims_part_",
    table: "warranty_claims",
    columns: Object.keys(claims[0]),
    conflictTarget: ["claim_id"]
  },
  {
    csvFile: "product_returns_apr2024_may2026.csv",
    outputFilePrefix: "041_seed_product_returns_part_",
    table: "product_returns",
    columns: Object.keys(returns[0]),
    conflictTarget: ["return_id"]
  },
  {
    csvFile: "monthly_warranty_return_volume_apr2024_may2026.csv",
    outputFilePrefix: "042_seed_monthly_warranty_return_volume_part_",
    table: "monthly_warranty_return_volume",
    columns: Object.keys(monthly[0]),
    conflictTarget: ["month", "service_center_id", "claim_type", "return_reason", "age_bucket", "model_id", "variant_id"]
  }
];

for (const config of configs) {
  const rows = config.table === "warranty_claims" ? claims : config.table === "product_returns" ? returns : monthly;
  writeSeedSql(config, rows).forEach((file) => console.log(`Generated ${file.outputFile} (${file.bytes} bytes)`));
}

console.log(`Generated ${claims.length} warranty claim rows`);
console.log(`Generated ${returns.length} product return rows`);
console.log(`Generated ${monthly.length} monthly warranty/return rows`);
