BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS service_center_id VARCHAR(16) REFERENCES service_centers(service_center_id) ON UPDATE CASCADE ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_users_service_center_id ON users(service_center_id);

INSERT INTO users (
  username,
  employee_name,
  job_title,
  reports_to_id,
  dealer_id,
  service_center_id,
  region,
  hire_date,
  role_id,
  password_hash,
  is_active
)
SELECT
  'PRT' || RIGHT(sc.service_center_id, 3),
  sc.service_center_name || ' Parts Manager',
  'Parts Manager',
  NULL,
  NULL,
  sc.service_center_id,
  sc.region,
  CURRENT_DATE,
  r.role_id,
  'pbkdf2$210000$d60a9b441f9ccd35910115ed716c2f37$bfd410ebc7c11fe374d8c8b428ea1c4ba723843b7c8d6716ac1a0d2640ac7c9a867672b2bd8cc2b3a0a7643e1b39afdbeb82c2b06033b46e91df4708f57bbbd4',
  sc.is_active
FROM service_centers sc
JOIN roles r ON r.role_name = 'Parts Manager'
ON CONFLICT (username) DO UPDATE
SET
  employee_name = EXCLUDED.employee_name,
  job_title = EXCLUDED.job_title,
  dealer_id = EXCLUDED.dealer_id,
  service_center_id = EXCLUDED.service_center_id,
  region = EXCLUDED.region,
  role_id = EXCLUDED.role_id,
  password_hash = EXCLUDED.password_hash,
  is_active = EXCLUDED.is_active;

COMMIT;
