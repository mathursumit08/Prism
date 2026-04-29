import { pool } from "../db.js";
import { buildUserProfile } from "./accessControl.js";
import { hashRefreshToken } from "./tokens.js";

function buildUserQuery(whereClause) {
  return `
    SELECT
      u.username,
      u.employee_name,
      u.job_title,
      u.dealer_id,
      u.region,
      u.password_hash,
      u.is_active,
      u.last_login_at,
      u.last_logout_at,
      r.role_name,
      COALESCE(
        ARRAY_AGG(p.permission_name ORDER BY p.permission_name)
        FILTER (WHERE p.permission_name IS NOT NULL),
        ARRAY[]::VARCHAR[]
      ) AS permissions
    FROM users u
    LEFT JOIN roles r ON r.role_id = u.role_id
    LEFT JOIN role_permissions rp ON rp.role_id = r.role_id
    LEFT JOIN permissions p ON p.permission_id = rp.permission_id
    WHERE ${whereClause}
    GROUP BY
      u.username,
      u.employee_name,
      u.job_title,
      u.dealer_id,
      u.region,
      u.password_hash,
      u.is_active,
      u.last_login_at,
      u.last_logout_at,
      r.role_name
    LIMIT 1
  `;
}

export async function findUserForLogin(username) {
  const result = await pool.query(buildUserQuery("LOWER(u.username) = LOWER($1)"), [username]);
  return result.rows[0] ?? null;
}

export async function findUserByUsername(username) {
  const result = await pool.query(buildUserQuery("u.username = $1"), [username]);
  return result.rows[0] ?? null;
}

export async function getSessionUser(username) {
  const user = await findUserByUsername(username);
  if (!user) {
    return null;
  }

  return buildUserProfile(user);
}

export async function recordLogin(username) {
  await pool.query(
    `
      UPDATE users
      SET last_login_at = NOW()
      WHERE username = $1
    `,
    [username]
  );
}

export async function recordLogout(username) {
  await pool.query(
    `
      UPDATE users
      SET last_logout_at = NOW()
      WHERE username = $1
    `,
    [username]
  );
}

export async function storeRefreshToken(username, refreshToken, expiresAt) {
  await pool.query(
    `
      INSERT INTO user_refresh_tokens (username, token_hash, expires_at)
      VALUES ($1, $2, $3)
    `,
    [username, hashRefreshToken(refreshToken), expiresAt]
  );
}

export async function rotateRefreshToken(previousToken, nextToken, username, expiresAt) {
  await revokeRefreshToken(previousToken);
  await storeRefreshToken(username, nextToken, expiresAt);
}

export async function touchRefreshToken(refreshToken) {
  const result = await pool.query(
    `
      UPDATE user_refresh_tokens
      SET last_used_at = NOW()
      WHERE token_hash = $1
        AND revoked_at IS NULL
        AND expires_at > NOW()
      RETURNING username
    `,
    [hashRefreshToken(refreshToken)]
  );

  return result.rows[0]?.username ?? null;
}

export async function revokeRefreshToken(refreshToken) {
  if (!refreshToken) {
    return;
  }

  await pool.query(
    `
      UPDATE user_refresh_tokens
      SET revoked_at = NOW()
      WHERE token_hash = $1
        AND revoked_at IS NULL
    `,
    [hashRefreshToken(refreshToken)]
  );
}
