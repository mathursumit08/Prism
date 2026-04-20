import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "../../db.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const scriptsDir = path.resolve(__dirname, "../scripts");
const migrationLockId = 46013519;

async function ensureMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id VARCHAR(255) PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function getAppliedMigrations(client) {
  const result = await client.query("SELECT id FROM schema_migrations");
  return new Set(result.rows.map((row) => row.id));
}

async function run() {
  const client = await pool.connect();

  try {
    await client.query("SELECT pg_advisory_lock($1)", [migrationLockId]);
    await ensureMigrationsTable(client);

    const applied = await getAppliedMigrations(client);
    const files = (await fs.readdir(scriptsDir)).filter((file) => file.endsWith(".sql")).sort();

    for (const file of files) {
      if (applied.has(file)) {
        console.log(`Skipping ${file}`);
        continue;
      }

      const sql = await fs.readFile(path.join(scriptsDir, file), "utf8");
      console.log(`Applying ${file}`);
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (id) VALUES ($1)", [file]);
      applied.add(file);
    }

    console.log("Migrations complete");
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [migrationLockId]).catch(() => {});
    client.release();
    await pool.end();
  }
}

run().catch(async (error) => {
  console.error(error);
  await pool.end();
  process.exit(1);
});
