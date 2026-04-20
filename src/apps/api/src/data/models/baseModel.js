import { pool } from "../../db.js";

function buildWhereClause(filters, allowedFilters) {
  const entries = Object.entries(filters).filter(([, value]) => value !== undefined);
  const values = [];
  const clauses = [];

  for (const [key, value] of entries) {
    const column = allowedFilters[key];

    if (!column) {
      continue;
    }

    values.push(value);
    clauses.push(`${column} = $${values.length}`);
  }

  return {
    text: clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "",
    values
  };
}

export function createModel({ tableName, primaryKey, allowedFilters = {} }) {
  return {
    async findAll({ filters = {}, limit = 100, offset = 0 } = {}) {
      const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 1000);
      const safeOffset = Math.max(Number(offset) || 0, 0);
      const where = buildWhereClause(filters, allowedFilters);
      const limitParam = where.values.length + 1;
      const offsetParam = where.values.length + 2;

      const result = await pool.query(
        `SELECT * FROM ${tableName} ${where.text} ORDER BY ${primaryKey} LIMIT $${limitParam} OFFSET $${offsetParam}`,
        [...where.values, safeLimit, safeOffset]
      );

      return result.rows;
    },

    async findById(id) {
      const result = await pool.query(`SELECT * FROM ${tableName} WHERE ${primaryKey} = $1`, [id]);
      return result.rows[0] ?? null;
    }
  };
}
