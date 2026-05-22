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

const months = ["2025-12-01", "2026-01-01", "2026-02-01", "2026-03-01", "2026-04-01", "2026-05-01"];
const regions = {
  North: [
    ["New Delhi", "Delhi"],
    ["Noida", "Uttar Pradesh"],
    ["Chandigarh", "Chandigarh"],
    ["Dehradun", "Uttarakhand"],
    ["Jaipur", "Rajasthan"],
    ["Ludhiana", "Punjab"],
    ["Lucknow", "Uttar Pradesh"],
    ["Jodhpur", "Rajasthan"],
    ["Gurugram", "Haryana"],
    ["Kanpur", "Uttar Pradesh"],
    ["Amritsar", "Punjab"],
    ["Shimla", "Himachal Pradesh"],
    ["Agra", "Uttar Pradesh"],
    ["Udaipur", "Rajasthan"],
    ["Faridabad", "Haryana"]
  ],
  West: [
    ["Mumbai", "Maharashtra"],
    ["Pune", "Maharashtra"],
    ["Ahmedabad", "Gujarat"],
    ["Surat", "Gujarat"],
    ["Navi Mumbai", "Maharashtra"],
    ["Vadodara", "Gujarat"],
    ["Nashik", "Maharashtra"],
    ["Rajkot", "Gujarat"],
    ["Indore", "Madhya Pradesh"],
    ["Bhopal", "Madhya Pradesh"],
    ["Nagpur", "Maharashtra"],
    ["Thane", "Maharashtra"],
    ["Aurangabad", "Maharashtra"],
    ["Gandhinagar", "Gujarat"],
    ["Kolhapur", "Maharashtra"]
  ],
  South: [
    ["Bengaluru", "Karnataka"],
    ["Chennai", "Tamil Nadu"],
    ["Hyderabad", "Telangana"],
    ["Kochi", "Kerala"],
    ["Mysuru", "Karnataka"],
    ["Coimbatore", "Tamil Nadu"],
    ["Madurai", "Tamil Nadu"],
    ["Vijayawada", "Andhra Pradesh"],
    ["Visakhapatnam", "Andhra Pradesh"],
    ["Trivandrum", "Kerala"],
    ["Mangaluru", "Karnataka"],
    ["Salem", "Tamil Nadu"],
    ["Warangal", "Telangana"],
    ["Tirupati", "Andhra Pradesh"],
    ["Hubballi", "Karnataka"]
  ],
  East: [
    ["Kolkata", "West Bengal"],
    ["Bhubaneswar", "Odisha"],
    ["Guwahati", "Assam"],
    ["Patna", "Bihar"],
    ["Ranchi", "Jharkhand"],
    ["Siliguri", "West Bengal"],
    ["Durgapur", "West Bengal"],
    ["Cuttack", "Odisha"],
    ["Jamshedpur", "Jharkhand"],
    ["Raipur", "Chhattisgarh"],
    ["Bilaspur", "Chhattisgarh"],
    ["Shillong", "Meghalaya"],
    ["Muzaffarpur", "Bihar"],
    ["Asansol", "West Bengal"],
    ["Imphal", "Manipur"]
  ]
};

const partCatalog = [
  ["Engine Oil Filter", "Filters", "Consumable", 220, "High"],
  ["Air Filter Element", "Filters", "Consumable", 430, "Medium"],
  ["Cabin Pollen Filter", "Filters", "Consumable", 520, "Medium"],
  ["Fuel Filter", "Filters", "Consumable", 760, "High"],
  ["Front Brake Pad Kit", "Braking", "Wear Part", 1850, "High"],
  ["Rear Brake Shoe Set", "Braking", "Wear Part", 1650, "High"],
  ["Brake Disc Rotor", "Braking", "Mechanical", 2850, "High"],
  ["Brake Fluid DOT4", "Fluids", "Consumable", 390, "High"],
  ["Clutch Plate", "Transmission", "Mechanical", 3450, "High"],
  ["Pressure Plate", "Transmission", "Mechanical", 3850, "High"],
  ["Release Bearing", "Transmission", "Mechanical", 1100, "Medium"],
  ["Spark Plug", "Ignition", "Consumable", 310, "Medium"],
  ["Glow Plug", "Ignition", "Electrical", 780, "Medium"],
  ["Ignition Coil", "Ignition", "Electrical", 2450, "High"],
  ["12V Battery", "Electrical", "Electrical", 6400, "High"],
  ["Alternator Assembly", "Electrical", "Electrical", 11800, "High"],
  ["Starter Motor", "Electrical", "Electrical", 9800, "High"],
  ["Headlamp Assembly LH", "Lighting", "Body Electrical", 7600, "Medium"],
  ["Headlamp Assembly RH", "Lighting", "Body Electrical", 7600, "Medium"],
  ["Tail Lamp Assembly LH", "Lighting", "Body Electrical", 3900, "Medium"],
  ["Tail Lamp Assembly RH", "Lighting", "Body Electrical", 3900, "Medium"],
  ["Wiper Blade Set", "Body", "Consumable", 680, "Low"],
  ["Front Bumper", "Body", "Body Panel", 5200, "Medium"],
  ["Rear Bumper", "Body", "Body Panel", 5100, "Medium"],
  ["Bonnet Panel", "Body", "Body Panel", 8900, "Low"],
  ["Front Door LH", "Body", "Body Panel", 11800, "Low"],
  ["Front Door RH", "Body", "Body Panel", 11800, "Low"],
  ["Radiator Assembly", "Cooling", "Mechanical", 6200, "High"],
  ["Cooling Fan Motor", "Cooling", "Electrical", 4500, "High"],
  ["Thermostat Valve", "Cooling", "Mechanical", 950, "Medium"],
  ["Water Pump", "Cooling", "Mechanical", 3100, "High"],
  ["Shock Absorber Front", "Suspension", "Mechanical", 2900, "Medium"],
  ["Shock Absorber Rear", "Suspension", "Mechanical", 2500, "Medium"],
  ["Lower Arm Assembly", "Suspension", "Mechanical", 3400, "Medium"],
  ["Stabilizer Link", "Suspension", "Mechanical", 890, "Medium"],
  ["Steering Rack", "Steering", "Mechanical", 14500, "High"],
  ["Tie Rod End", "Steering", "Mechanical", 790, "Medium"],
  ["Wheel Bearing", "Wheel End", "Mechanical", 1650, "Medium"],
  ["Tyre Pressure Sensor", "Wheel End", "Electrical", 2100, "Low"],
  ["AC Filter", "HVAC", "Consumable", 580, "Medium"],
  ["AC Compressor", "HVAC", "Mechanical", 18200, "High"],
  ["Blower Motor", "HVAC", "Electrical", 3900, "Medium"],
  ["Oxygen Sensor", "Sensors", "Electrical", 3200, "Medium"],
  ["MAP Sensor", "Sensors", "Electrical", 2200, "Medium"],
  ["ABS Sensor", "Sensors", "Electrical", 1800, "High"],
  ["ECU Module", "Electronics", "Electrical", 28500, "High"],
  ["Infotainment Unit", "Electronics", "Electrical", 22500, "Low"],
  ["Charging Port", "EV System", "Electrical", 12500, "High"],
  ["Traction Battery Coolant", "EV System", "Fluid", 950, "High"],
  ["DC-DC Converter", "EV System", "Electrical", 34200, "High"]
];

const serviceTypes = ["Periodic Service", "Running Repair", "Warranty Repair", "Accident Repair", "Inspection", "Recall Campaign"];
const jobCategories = ["Maintenance", "Mechanical", "Electrical", "Body Repair", "Diagnostics", "Campaign"];
const channels = ["Appointment", "Walk-in", "Pickup-Drop", "Fleet"];
const statuses = ["Completed", "Completed", "Completed", "Completed", "Cancelled", "Open"];

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

const random = mulberry32(20260519);

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

function addDays(dateText, days) {
  const date = new Date(`${dateText}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function csvEscape(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
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

  if (value === true || value === "true") {
    return "TRUE";
  }

  if (value === false || value === "false") {
    return "FALSE";
  }

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
    if (!config.outputFilePrefix) {
      return config.outputFile;
    }

    return `${config.outputFilePrefix}${pad(part, 2)}${config.outputFileSuffix}`;
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

    if (config.outputFilePrefix && bytes > Buffer.byteLength("BEGIN;\n\nSET CONSTRAINTS ALL DEFERRED;\n\n") && bytes + insertBytes + Buffer.byteLength("COMMIT;\n") > maxSeedBytes) {
      flushFile();
    }

    sql += insertSql;
    bytes += insertBytes;
  }

  flushFile();
  return files;
}

function buildServiceCenters() {
  const names = ["Prime Care", "Apex Service", "Rapid Auto Care", "City Workshop", "DriveWell Service"];
  let index = 1;

  return Object.entries(regions).flatMap(([region, cities]) =>
    cities.map(([city, state], cityIndex) => {
      const centerType = cityIndex < 3 ? "Metro" : cityIndex < 9 ? "Urban" : "Tier-2";
      const capacity = centerType === "Metro" ? 82 + cityIndex * 3 : centerType === "Urban" ? 52 + cityIndex * 2 : 34 + cityIndex;
      const bays = Math.max(6, Math.round(capacity / 8));

      return {
        service_center_id: `SVC${pad(index++, 3)}`,
        service_center_name: `${pick(names)} ${city}`,
        region,
        city,
        state,
        center_type: centerType,
        service_capacity_per_day: capacity,
        active_technicians: Math.max(8, Math.round(capacity / 5)),
        service_bays: bays,
        is_active: true
      };
    })
  );
}

function buildServiceParts() {
  return Array.from({ length: 150 }, (_value, index) => {
    const template = partCatalog[index % partCatalog.length];
    const suffix = Math.floor(index / partCatalog.length) + 1;
    const categoryDemandClass = ["A", "B", "C"][index % 3];

    return {
      part_id: `PRT${pad(index + 1, 4)}`,
      part_number: `APX-${pad(index + 1, 5)}`,
      part_name: suffix === 1 ? template[0] : `${template[0]} ${suffix}`,
      part_category: template[1],
      part_type: template[2],
      uom: template[2] === "Fluid" ? "L" : "EA",
      unit_cost: Math.round(template[3] * (0.92 + suffix * 0.08)),
      criticality: template[4],
      abc_class: categoryDemandClass,
      replaced_by_part_id: index > 130 && index % 5 === 0 ? `PRT${pad(index - 100, 4)}` : "",
      is_active: index < 145
    };
  });
}

function buildPartsDemand(centers, parts) {
  const rows = [];

  centers.forEach((center, centerIndex) => {
    parts.forEach((part, partIndex) => {
      months.forEach((month, monthIndex) => {
        const baseRate = part.abc_class === "A" ? 7 : part.abc_class === "B" ? 3 : 1;
        const centerScale = center.center_type === "Metro" ? 1.35 : center.center_type === "Urban" ? 1 : 0.72;
        const intermittentCutoff = part.abc_class === "C" ? 0.62 : part.abc_class === "B" ? 0.28 : 0.08;
        const seasonal = monthIndex === 4 || monthIndex === 5 ? 1.18 : monthIndex === 1 ? 1.08 : 1;
        const demandSignal = baseRate * centerScale * seasonal + ((centerIndex + partIndex + monthIndex) % 4);
        const demanded = random() < intermittentCutoff ? 0 : Math.max(0, Math.round(demandSignal + random() * baseRate));
        const stockoutDays = demanded > 0 && random() < 0.1 ? 1 + Math.floor(random() * 5) : 0;
        const lostSales = stockoutDays > 0 ? Math.min(demanded, 1 + Math.floor(random() * 3)) : 0;
        const backordered = stockoutDays > 0 ? Math.min(demanded, Math.floor(random() * 3)) : 0;
        const fulfilled = Math.max(0, demanded - lostSales - backordered);
        const opening = Math.max(0, fulfilled + Math.floor(random() * 12));
        const received = Math.max(0, demanded + Math.floor(random() * 8) - opening);
        const closing = Math.max(0, opening + received - fulfilled);
        const variantNumber = ((partIndex + centerIndex) % 72) + 1;
        const modelNumber = Math.floor((variantNumber - 1) / 6) + 1;

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
          warranty_quantity: Math.round(fulfilled * (0.12 + random() * 0.18)),
          paid_quantity: Math.max(0, fulfilled - Math.round(fulfilled * (0.12 + random() * 0.18)))
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
    months.forEach((month, monthIndex) => {
      const baseOrders = center.center_type === "Metro" ? 210 : center.center_type === "Urban" ? 145 : 95;
      const volume = Math.round(baseOrders * (monthIndex === 4 || monthIndex === 5 ? 1.14 : 1) * (0.86 + random() * 0.28));

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
          service_order_id: `SO${pad(orderNumber++, 7)}`,
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

const serviceCenters = buildServiceCenters();
const serviceParts = buildServiceParts();
const partsDemand = buildPartsDemand(serviceCenters, serviceParts);
const serviceOrders = buildServiceOrders(serviceCenters);
const serviceOrderVolume = buildServiceOrderVolume(serviceOrders, serviceCenters);

writeCsv("service_centers.csv", serviceCenters);
writeCsv("service_parts.csv", serviceParts);
writeCsv("monthly_service_parts_demand.csv", partsDemand);
writeCsv("service_orders.csv", serviceOrders);
writeCsv("monthly_service_order_volume.csv", serviceOrderVolume);

const seedConfigs = [
  {
    csvFile: "service_centers.csv",
    outputFile: "025_seed_service_centers.sql",
    table: "service_centers",
    columns: Object.keys(serviceCenters[0]),
    conflictTarget: ["service_center_id"]
  },
  {
    csvFile: "service_parts.csv",
    outputFile: "026_seed_service_parts.sql",
    table: "service_parts",
    columns: Object.keys(serviceParts[0]),
    conflictTarget: ["part_id"]
  },
  {
    csvFile: "monthly_service_parts_demand.csv",
    outputFilePrefix: "027_seed_monthly_service_parts_demand_part_",
    outputFileSuffix: ".sql",
    table: "monthly_service_parts_demand",
    columns: Object.keys(partsDemand[0]),
    conflictTarget: ["month", "service_center_id", "part_id", "model_id", "variant_id"]
  },
  {
    csvFile: "service_orders.csv",
    outputFilePrefix: "028_seed_service_orders_part_",
    outputFileSuffix: ".sql",
    table: "service_orders",
    columns: Object.keys(serviceOrders[0]),
    conflictTarget: ["service_order_id"]
  },
  {
    csvFile: "monthly_service_order_volume.csv",
    outputFilePrefix: "029_seed_monthly_service_order_volume_part_",
    outputFileSuffix: ".sql",
    table: "monthly_service_order_volume",
    columns: Object.keys(serviceOrderVolume[0]),
    conflictTarget: ["month", "service_center_id", "service_type", "job_category", "model_id", "variant_id"]
  }
];

for (const config of seedConfigs) {
  const sourceRows = {
    "service_centers.csv": serviceCenters,
    "service_parts.csv": serviceParts,
    "monthly_service_parts_demand.csv": partsDemand,
    "service_orders.csv": serviceOrders,
    "monthly_service_order_volume.csv": serviceOrderVolume
  }[config.csvFile];
  const files = writeSeedSql(config, sourceRows);
  files.forEach((file) => console.log(`Generated ${file.outputFile} (${file.bytes} bytes)`));
}

console.log(`Generated ${serviceCenters.length} service centers`);
console.log(`Generated ${serviceParts.length} service parts`);
console.log(`Generated ${partsDemand.length} monthly service parts demand rows`);
console.log(`Generated ${serviceOrders.length} service orders`);
console.log(`Generated ${serviceOrderVolume.length} monthly service order volume rows`);
