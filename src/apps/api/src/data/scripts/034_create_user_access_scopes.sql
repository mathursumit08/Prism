BEGIN;

CREATE TABLE IF NOT EXISTS user_access_scopes (
  scope_id BIGSERIAL PRIMARY KEY,
  username VARCHAR(64) NOT NULL REFERENCES users(username) ON UPDATE CASCADE ON DELETE CASCADE,
  domain VARCHAR(16) NOT NULL CHECK (domain IN ('Sales', 'Parts', 'Service')),
  scope_type VARCHAR(24) NOT NULL CHECK (scope_type IN ('National', 'Region', 'Dealer', 'Service Center')),
  scope_value VARCHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT user_access_scopes_scope_value_required CHECK (
    (scope_type = 'National' AND scope_value IS NULL)
    OR (scope_type <> 'National' AND scope_value IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_access_scopes_unique
  ON user_access_scopes (username, domain, scope_type, scope_value) NULLS NOT DISTINCT;

CREATE INDEX IF NOT EXISTS idx_user_access_scopes_username
  ON user_access_scopes(username);

CREATE INDEX IF NOT EXISTS idx_user_access_scopes_domain_scope
  ON user_access_scopes(domain, scope_type, scope_value);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'users'
      AND column_name = 'dealer_id'
  ) THEN
    INSERT INTO user_access_scopes (username, domain, scope_type, scope_value)
    SELECT username, 'Sales', 'Dealer', dealer_id
    FROM users
    WHERE dealer_id IS NOT NULL
    ON CONFLICT (username, domain, scope_type, scope_value) DO NOTHING;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'users'
      AND column_name = 'service_center_id'
  ) THEN
    INSERT INTO user_access_scopes (username, domain, scope_type, scope_value)
    SELECT u.username, 'Parts', 'Service Center', u.service_center_id
    FROM users u
    JOIN roles r ON r.role_id = u.role_id
    JOIN role_permissions rp ON rp.role_id = r.role_id
    JOIN permissions p ON p.permission_id = rp.permission_id
    WHERE u.service_center_id IS NOT NULL
      AND p.permission_name = 'View Parts Forecast'
    ON CONFLICT (username, domain, scope_type, scope_value) DO NOTHING;

    INSERT INTO user_access_scopes (username, domain, scope_type, scope_value)
    SELECT u.username, 'Service', 'Service Center', u.service_center_id
    FROM users u
    JOIN roles r ON r.role_id = u.role_id
    JOIN role_permissions rp ON rp.role_id = r.role_id
    JOIN permissions p ON p.permission_id = rp.permission_id
    WHERE u.service_center_id IS NOT NULL
      AND p.permission_name = 'View Service Forecast'
    ON CONFLICT (username, domain, scope_type, scope_value) DO NOTHING;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'users'
      AND column_name = 'region'
  ) THEN
    INSERT INTO user_access_scopes (username, domain, scope_type, scope_value)
    SELECT u.username, 'Sales', 'Region', u.region
    FROM users u
    JOIN roles r ON r.role_id = u.role_id
    JOIN role_permissions rp ON rp.role_id = r.role_id
    JOIN permissions p ON p.permission_id = rp.permission_id
    WHERE u.region IS NOT NULL
      AND r.role_name = 'Regional Head'
      AND p.permission_name = 'View Forecast'
    ON CONFLICT (username, domain, scope_type, scope_value) DO NOTHING;

    INSERT INTO user_access_scopes (username, domain, scope_type, scope_value)
    SELECT u.username, 'Parts', 'Region', u.region
    FROM users u
    JOIN roles r ON r.role_id = u.role_id
    JOIN role_permissions rp ON rp.role_id = r.role_id
    JOIN permissions p ON p.permission_id = rp.permission_id
    WHERE u.region IS NOT NULL
      AND r.role_name = 'Regional Head'
      AND p.permission_name = 'View Parts Forecast'
    ON CONFLICT (username, domain, scope_type, scope_value) DO NOTHING;

    INSERT INTO user_access_scopes (username, domain, scope_type, scope_value)
    SELECT u.username, 'Service', 'Region', u.region
    FROM users u
    JOIN roles r ON r.role_id = u.role_id
    JOIN role_permissions rp ON rp.role_id = r.role_id
    JOIN permissions p ON p.permission_id = rp.permission_id
    WHERE u.region IS NOT NULL
      AND r.role_name = 'Regional Head'
      AND p.permission_name = 'View Service Forecast'
    ON CONFLICT (username, domain, scope_type, scope_value) DO NOTHING;
  END IF;
END $$;

INSERT INTO user_access_scopes (username, domain, scope_type, scope_value)
SELECT u.username, 'Sales', 'National', NULL
FROM users u
JOIN roles r ON r.role_id = u.role_id
JOIN role_permissions rp ON rp.role_id = r.role_id
JOIN permissions p ON p.permission_id = rp.permission_id
WHERE r.role_name IN ('Admin', 'National Head')
  AND p.permission_name = 'View Forecast'
ON CONFLICT (username, domain, scope_type, scope_value) DO NOTHING;

INSERT INTO user_access_scopes (username, domain, scope_type, scope_value)
SELECT u.username, 'Parts', 'National', NULL
FROM users u
JOIN roles r ON r.role_id = u.role_id
JOIN role_permissions rp ON rp.role_id = r.role_id
JOIN permissions p ON p.permission_id = rp.permission_id
WHERE r.role_name IN ('Admin', 'National Head')
  AND p.permission_name = 'View Parts Forecast'
ON CONFLICT (username, domain, scope_type, scope_value) DO NOTHING;

INSERT INTO user_access_scopes (username, domain, scope_type, scope_value)
SELECT u.username, 'Service', 'National', NULL
FROM users u
JOIN roles r ON r.role_id = u.role_id
JOIN role_permissions rp ON rp.role_id = r.role_id
JOIN permissions p ON p.permission_id = rp.permission_id
WHERE r.role_name IN ('Admin', 'National Head')
  AND p.permission_name = 'View Service Forecast'
ON CONFLICT (username, domain, scope_type, scope_value) DO NOTHING;

ALTER TABLE users
  DROP COLUMN IF EXISTS dealer_id,
  DROP COLUMN IF EXISTS service_center_id,
  DROP COLUMN IF EXISTS region;

COMMIT;
