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
const months = buildMonths("2024-04-01", "2025-11-01");
const serviceTypes = ["Periodic Service", "Running Repair", "Warranty Repair", "Accident Repair", "Inspection", "Recall Campaign"];
const jobCategories = ["Maintenance", "Mechanical", "Electrical", "Body Repair", "Diagnostics", "Campaign"];
const channels = ["Appointment", "Walk-in", "Pickup-Drop", "Fleet"];
const statuses = ["Completed", "Completed", "Completed", "Completed", "Cancelled", "Open"];

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

const random = mulberry32(20260525);

function pick(values) {
  return values[Math.floor(random() * values.length)];
}

function pad(value, length) {
  return String(value).padStart(length, "0");
}

function monthEndDay(month) {
  const date = new Date(`${month}T00:00:00.000Z`);
  date.setUTCMonth(date.getUTCMonth() + 1);
  date.setUTCDate(0);
  return date.getUTCDate();
}

function monthIndexFromStart(month) {
  return months.indexOf(month);
}

function seasonalFactor(month) {
  const monthNumber = Number(month.slice(5, 7));
  if ([10, 11].includes(monthNumber)) return 1.18;
  if ([4, 5].includes(monthNumber)) return 1.1;
  if ([7, 8].includes(monthNumber)) return 0.94;
  return 1;
}

function trendFactor(month) {
  return 0.88 + monthIndexFromStart(month) * 0.012;
}

function addDays(dateText, days) {
  const date = new Date(`${dateText}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function csvEscape(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
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

function writeCsv(fileName, rows) {
  const headers = Object.keys(rows[0] ?? {});
  const csv = [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(","))
  ].join("\n") + "\n";

  fs.writeFileSync(path.join(dataDir, fileName), csv, "utf8");
}

function sqlValue(value) {
  if (value === "" || value === null || value === undefined) {
    return "NULL";
  }

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

  function fileName() {
    return config.outputFilePrefix
      ? `${config.outputFilePrefix}${pad(part, 2)}${config.outputFileSuffix}`
      : config.outputFile;
  }

  function reset() {
    sql = `BEGIN;\n\nSET CONSTRAINTS ALL DEFERRED;\n\n-- ${config.csvFile}\n`;
    bytes = Buffer.byteLength(sql);
  }

  function flushFile() {
    sql += "COMMIT;\n";
    const outputFile = fileName();
    fs.writeFileSync(path.join(scriptsDir, outputFile), sql, "utf8");
    files.push({ outputFile, bytes: Buffer.byteLength(sql) });
    part += 1;
    reset();
  }

  reset();
  for (let index = 0; index < rows.length; index += batchSize) {
    const insertSql = buildInsertSql(config, rows.slice(index, index + batchSize));
    const insertBytes = Buffer.byteLength(insertSql);
    const hasRows = bytes > Buffer.byteLength("BEGIN;\n\nSET CONSTRAINTS ALL DEFERRED;\n\n");

    if (config.outputFilePrefix && hasRows && bytes + insertBytes + Buffer.byteLength("COMMIT;\n") > maxSeedBytes) {
      flushFile();
    }

    sql += insertSql;
    bytes += insertBytes;
  }

  flushFile();
  return files;
}

function buildPartsDemand(centers, parts) {
  const rows = [];

  centers.forEach((center, centerIndex) => {
    parts.forEach((part, partIndex) => {
      months.forEach((month, index) => {
        const baseRate = part.abc_class === "A" ? 6.5 : part.abc_class === "B" ? 2.8 : 0.95;
        const centerScale = center.center_type === "Metro" ? 1.32 : center.center_type === "Urban" ? 1 : 0.7;
        const intermittentCutoff = part.abc_class === "C" ? 0.66 : part.abc_class === "B" ? 0.31 : 0.1;
        const demandSignal = baseRate * centerScale * seasonalFactor(month) * trendFactor(month) + ((centerIndex + partIndex + index) % 4);
        const demanded = random() < intermittentCutoff ? 0 : Math.max(0, Math.round(demandSignal + random() * baseRate));
        const stockoutDays = demanded > 0 && random() < 0.11 ? 1 + Math.floor(random() * 5) : 0;
        const lostSales = stockoutDays > 0 ? Math.min(demanded, 1 + Math.floor(random() * 3)) : 0;
        const backordered = stockoutDays > 0 ? Math.min(demanded, Math.floor(random() * 3)) : 0;
        const fulfilled = Math.max(0, demanded - lostSales - backordered);
        const opening = Math.max(0, fulfilled + Math.floor(random() * 11));
        const received = Math.max(0, demanded + Math.floor(random() * 8) - opening);
        const closing = Math.max(0, opening + received - fulfilled);
        const variantNumber = ((partIndex + centerIndex) % 72) + 1;
        const modelNumber = Math.floor((variantNumber - 1) / 6) + 1;
        const warrantyShare = 0.1 + random() * 0.16;
        const warrantyQuantity = Math.round(fulfilled * warrantyShare);

        rows.push({
          month,
          service_center_id: center.service_center_id,
          part_id: part.part_id,
          model_id: `MDL${pad(modelNumber, 3)}`,
          variant_id: `VAR${pad(variantNumber, 3)}`,
          quantity_demanded: demanded,
          quantity_fulfilled: fulfilled,
          quantity_backordered: backordered,
          lost_sales_quantity: lostSales,
          opening_stock: opening,
          stock_received: received,
          closing_stock: closing,
          stockout_days: stockoutDays,
          average_lead_time_days: (2 + random() * 8).toFixed(1),
          warranty_quantity: warrantyQuantity,
          paid_quantity: Math.max(0, fulfilled - warrantyQuantity)
        });
      });
    });
  });

  return rows;
}

function buildServiceOrders(centers) {
  const rows = [];
  let orderNumber = 1;

  centers.forEach((center, centerIndex) => {
    months.forEach((month) => {
      const baseOrders = center.center_type === "Metro" ? 195 : center.center_type === "Urban" ? 132 : 86;
      const volume = Math.round(baseOrders * seasonalFactor(month) * trendFactor(month) * (0.86 + random() * 0.28));

      for (let index = 0; index < volume; index += 1) {
        const serviceType = pick(serviceTypes);
        const jobCategory = serviceType === "Recall Campaign" ? "Campaign" : serviceType === "Accident Repair" ? "Body Repair" : pick(jobCategories);
        const day = 1 + Math.floor(random() * monthEndDay(month));
        const orderDate = `${month.slice(0, 8)}${pad(day, 2)}`;
        const status = pick(statuses);
        const variantNumber = ((centerIndex * 7 + index) % 72) + 1;
        const modelNumber = Math.floor((variantNumber - 1) / 6) + 1;
        const laborHours = serviceType === "Periodic Service" ? 1.2 + random() * 2 : serviceType === "Accident Repair" ? 6 + random() * 18 : 2 + random() * 6;

        rows.push({
          service_order_id: `SOH${pad(orderNumber++, 8)}`,
          order_date: orderDate,
          month,
          service_center_id: center.service_center_id,
          model_id: `MDL${pad(modelNumber, 3)}`,
          variant_id: `VAR${pad(variantNumber, 3)}`,
          service_type: serviceType,
          job_category: jobCategory,
          service_channel: pick(channels),
          status,
          warranty_flag: serviceType === "Warranty Repair" || random() < 0.11,
          repeat_repair_flag: random() < 0.06,
          campaign_flag: serviceType === "Recall Campaign",
          appointment_flag: random() < 0.68,
          promised_delivery_date: addDays(orderDate, serviceType === "Accident Repair" ? 5 : 1),
          completed_date: status === "Completed" ? addDays(orderDate, serviceType === "Accident Repair" ? 4 + Math.floor(random() * 6) : Math.floor(random() * 3)) : "",
          labor_hours: laborHours.toFixed(1),
          bay_hours: (laborHours * (0.65 + random() * 0.25)).toFixed(1)
        });
      }
    });
  });

  return rows;
}

function buildServiceOrderVolume(orders, centers) {
  const centerById = new Map(centers.map((center) => [center.service_center_id, center]));
  const groups = new Map();

  for (const order of orders) {
    const key = [order.month, order.service_center_id, order.service_type, order.job_category, order.model_id, order.variant_id].join("|");
    if (!groups.has(key)) {
      const center = centerById.get(order.service_center_id);
      groups.set(key, {
        month: order.month,
        service_center_id: order.service_center_id,
        service_type: order.service_type,
        job_category: order.job_category,
        model_id: order.model_id,
        variant_id: order.variant_id,
        order_count: 0,
        completed_count: 0,
        cancelled_count: 0,
        warranty_count: 0,
        repeat_repair_count: 0,
        available_technicians: center.active_technicians,
        available_bays: center.service_bays,
        working_days: 24
      });
    }

    const group = groups.get(key);
    group.order_count += 1;
    group.completed_count += order.status === "Completed" ? 1 : 0;
    group.cancelled_count += order.status === "Cancelled" ? 1 : 0;
    group.warranty_count += order.warranty_flag ? 1 : 0;
    group.repeat_repair_count += order.repeat_repair_flag ? 1 : 0;
  }

  return [...groups.values()].sort((left, right) =>
    [left.month, left.service_center_id, left.service_type, left.job_category, left.model_id, left.variant_id]
      .join("|")
      .localeCompare([right.month, right.service_center_id, right.service_type, right.job_category, right.model_id, right.variant_id].join("|"))
  );
}

fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(scriptsDir, { recursive: true });

const serviceCenters = parseCsv("service_centers.csv").filter((center) => center.is_active !== "false");
const serviceParts = parseCsv("service_parts.csv").filter((part) => part.is_active !== "false");
const partsDemand = buildPartsDemand(serviceCenters, serviceParts);
const serviceOrders = buildServiceOrders(serviceCenters);
const serviceOrderVolume = buildServiceOrderVolume(serviceOrders, serviceCenters);

writeCsv("monthly_service_parts_demand_history_apr2024_nov2025.csv", partsDemand);
writeCsv("service_orders_history_apr2024_nov2025.csv", serviceOrders);
writeCsv("monthly_service_order_volume_history_apr2024_nov2025.csv", serviceOrderVolume);

const seedConfigs = [
  {
    csvFile: "monthly_service_parts_demand_history_apr2024_nov2025.csv",
    outputFilePrefix: "036_seed_monthly_service_parts_demand_history_part_",
    outputFileSuffix: ".sql",
    table: "monthly_service_parts_demand",
    columns: Object.keys(partsDemand[0]),
    conflictTarget: ["month", "service_center_id", "part_id", "model_id", "variant_id"]
  },
  {
    csvFile: "service_orders_history_apr2024_nov2025.csv",
    outputFilePrefix: "037_seed_service_orders_history_part_",
    outputFileSuffix: ".sql",
    table: "service_orders",
    columns: Object.keys(serviceOrders[0]),
    conflictTarget: ["service_order_id"]
  },
  {
    csvFile: "monthly_service_order_volume_history_apr2024_nov2025.csv",
    outputFilePrefix: "038_seed_monthly_service_order_volume_history_part_",
    outputFileSuffix: ".sql",
    table: "monthly_service_order_volume",
    columns: Object.keys(serviceOrderVolume[0]),
    conflictTarget: ["month", "service_center_id", "service_type", "job_category", "model_id", "variant_id"]
  }
];

for (const config of seedConfigs) {
  const sourceRows = {
    "monthly_service_parts_demand_history_apr2024_nov2025.csv": partsDemand,
    "service_orders_history_apr2024_nov2025.csv": serviceOrders,
    "monthly_service_order_volume_history_apr2024_nov2025.csv": serviceOrderVolume
  }[config.csvFile];
  const files = writeSeedSql(config, sourceRows);
  files.forEach((file) => console.log(`Generated ${file.outputFile} (${file.bytes} bytes)`));
}

console.log(`Generated ${months.length} months from ${months[0]} through ${months.at(-1)}`);
console.log(`Generated ${partsDemand.length} monthly service parts demand rows`);
console.log(`Generated ${serviceOrders.length} service order rows`);
console.log(`Generated ${serviceOrderVolume.length} monthly service order volume rows`);
