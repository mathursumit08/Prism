BEGIN;

CREATE TABLE IF NOT EXISTS roles (
  role_id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  role_name VARCHAR(64) NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS permissions (
  permission_id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  permission_name VARCHAR(64) NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id INTEGER NOT NULL REFERENCES roles(role_id) ON DELETE CASCADE,
  permission_id INTEGER NOT NULL REFERENCES permissions(permission_id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'sales_personnel'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'users'
  ) THEN
    EXECUTE 'ALTER TABLE sales_personnel RENAME TO users';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'users'
      AND column_name = 'employee_id'
  ) THEN
    EXECUTE 'ALTER TABLE users RENAME COLUMN employee_id TO username';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'users'
      AND column_name = 'role'
  ) THEN
    EXECUTE 'ALTER TABLE users RENAME COLUMN role TO job_title';
  END IF;
END $$;

ALTER TABLE users
ALTER COLUMN username TYPE VARCHAR(64),
ALTER COLUMN region DROP NOT NULL,
ADD COLUMN IF NOT EXISTS role_id INTEGER REFERENCES roles(role_id) ON DELETE RESTRICT,
ADD COLUMN IF NOT EXISTS password_hash TEXT,
ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE,
ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS user_refresh_tokens (
  refresh_token_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  username VARCHAR(64) NOT NULL REFERENCES users(username) ON UPDATE CASCADE ON DELETE CASCADE,
  token_hash CHAR(64) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ
);

INSERT INTO roles (role_name)
VALUES
  ('Admin'),
  ('National Head'),
  ('Regional Head'),
  ('Dealer Manager'),
  ('Team Lead'),
  ('Sales Executive')
ON CONFLICT (role_name) DO NOTHING;

INSERT INTO permissions (permission_name)
VALUES
  ('View Forecast'),
  ('Manage Forecast')
ON CONFLICT (permission_name) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM roles r
JOIN permissions p ON p.permission_name = 'View Forecast'
WHERE r.role_name IN ('Admin', 'National Head', 'Regional Head', 'Dealer Manager')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM roles r
JOIN permissions p ON p.permission_name = 'Manage Forecast'
WHERE r.role_name = 'Admin'
ON CONFLICT DO NOTHING;

UPDATE users
SET role_id = r.role_id
FROM roles r
WHERE (
  users.job_title = 'Regional Manager'
  AND r.role_name = 'Regional Head'
) OR (
  users.job_title = 'Dealer Sales Manager'
  AND r.role_name = 'Dealer Manager'
) OR (
  users.job_title = 'Team Lead'
  AND r.role_name = 'Team Lead'
) OR (
  users.job_title = 'Sales Executive'
  AND r.role_name = 'Sales Executive'
);

UPDATE users
SET password_hash = 'pbkdf2$210000$d60a9b441f9ccd35910115ed716c2f37$bfd410ebc7c11fe374d8c8b428ea1c4ba723843b7c8d6716ac1a0d2640ac7c9a867672b2bd8cc2b3a0a7643e1b39afdbeb82c2b06033b46e91df4708f57bbbd4'
WHERE password_hash IS NULL;

INSERT INTO users (username, employee_name, job_title, reports_to_id, dealer_id, region, hire_date, role_id, password_hash, is_active)
SELECT
  'admin',
  'System Admin',
  'Admin',
  NULL,
  NULL,
  NULL,
  CURRENT_DATE,
  r.role_id,
  'pbkdf2$210000$14fbfc98ababecfd73317297334e9cd2$38da74aad78fef22620210d00ffb86f9dd6fae4f48f8ffac5f6c1531b5bee5ff8d0e7f5f900e2cc01cb7c0e1e5392d9bae9338171be34babca2804a120855c51',
  TRUE
FROM roles r
WHERE r.role_name = 'Admin'
ON CONFLICT (username) DO UPDATE
SET
  employee_name = EXCLUDED.employee_name,
  job_title = EXCLUDED.job_title,
  role_id = EXCLUDED.role_id,
  password_hash = EXCLUDED.password_hash,
  is_active = EXCLUDED.is_active;

INSERT INTO users (username, employee_name, job_title, reports_to_id, dealer_id, region, hire_date, role_id, password_hash, is_active)
SELECT
  'national.head',
  'National Head',
  'National Head',
  NULL,
  NULL,
  NULL,
  CURRENT_DATE,
  r.role_id,
  'pbkdf2$210000$d60a9b441f9ccd35910115ed716c2f37$bfd410ebc7c11fe374d8c8b428ea1c4ba723843b7c8d6716ac1a0d2640ac7c9a867672b2bd8cc2b3a0a7643e1b39afdbeb82c2b06033b46e91df4708f57bbbd4',
  TRUE
FROM roles r
WHERE r.role_name = 'National Head'
ON CONFLICT (username) DO UPDATE
SET
  employee_name = EXCLUDED.employee_name,
  job_title = EXCLUDED.job_title,
  role_id = EXCLUDED.role_id,
  password_hash = EXCLUDED.password_hash,
  is_active = EXCLUDED.is_active;

SET CONSTRAINTS ALL IMMEDIATE;

DROP INDEX IF EXISTS idx_sales_personnel_dealer_id;
DROP INDEX IF EXISTS idx_sales_personnel_reports_to_id;

CREATE INDEX IF NOT EXISTS idx_users_dealer_id ON users(dealer_id);
CREATE INDEX IF NOT EXISTS idx_users_reports_to_id ON users(reports_to_id);
CREATE INDEX IF NOT EXISTS idx_users_role_id ON users(role_id);
CREATE INDEX IF NOT EXISTS idx_user_refresh_tokens_username ON user_refresh_tokens(username);
CREATE INDEX IF NOT EXISTS idx_user_refresh_tokens_expires_at ON user_refresh_tokens(expires_at);

COMMIT;
