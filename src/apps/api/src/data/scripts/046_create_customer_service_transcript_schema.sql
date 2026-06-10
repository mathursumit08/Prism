BEGIN;

ALTER TABLE user_access_scopes
  DROP CONSTRAINT IF EXISTS user_access_scopes_domain_check;

ALTER TABLE user_access_scopes
  ADD CONSTRAINT user_access_scopes_domain_check
    CHECK (domain IN ('Sales', 'Parts', 'Service', 'Warranty', 'SLA', 'Customer Service'));

CREATE TABLE IF NOT EXISTS customer_service_transcripts (
  transcript_id BIGSERIAL PRIMARY KEY,
  transcript_reference VARCHAR(40) NOT NULL UNIQUE,
  ownership_domain VARCHAR(32) NOT NULL DEFAULT 'Customer Service'
    CHECK (ownership_domain IN ('Sales', 'Parts', 'Service', 'Warranty', 'SLA', 'Customer Service', 'General')),
  source_type VARCHAR(32) NOT NULL DEFAULT 'Text'
    CHECK (source_type IN ('Text', 'Audio')),
  source_reference_id VARCHAR(80),
  customer_id VARCHAR(80),
  customer_name VARCHAR(160),
  customer_phone VARCHAR(40),
  dealer_id VARCHAR(16) REFERENCES dealers(dealer_id) ON UPDATE CASCADE ON DELETE SET NULL,
  service_center_id VARCHAR(16) REFERENCES service_centers(service_center_id) ON UPDATE CASCADE ON DELETE SET NULL,
  service_order_id VARCHAR(32),
  model_id VARCHAR(16) REFERENCES vehicle_models(model_id) ON UPDATE CASCADE ON DELETE SET NULL,
  variant_id VARCHAR(16) REFERENCES vehicle_variants(variant_id) ON UPDATE CASCADE ON DELETE SET NULL,
  channel VARCHAR(40) NOT NULL DEFAULT 'Phone'
    CHECK (channel IN ('Phone', 'WhatsApp', 'Email', 'Chat', 'Walk-in', 'Other')),
  transcript_text TEXT NOT NULL,
  language_code VARCHAR(16) NOT NULL DEFAULT 'en',
  transcript_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  audio_file_name VARCHAR(255),
  audio_storage_uri TEXT,
  audio_mime_type VARCHAR(80),
  audio_duration_seconds INTEGER CHECK (audio_duration_seconds IS NULL OR audio_duration_seconds >= 0),
  speech_to_text_status VARCHAR(24) NOT NULL DEFAULT 'not_required'
    CHECK (speech_to_text_status IN ('not_required', 'pending', 'processing', 'completed', 'failed')),
  speech_to_text_model VARCHAR(80),
  speech_to_text_error TEXT,
  uploaded_by VARCHAR(80) REFERENCES users(username) ON UPDATE CASCADE ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customer_service_transcripts_domain
  ON customer_service_transcripts(ownership_domain);

CREATE INDEX IF NOT EXISTS idx_customer_service_transcripts_dealer
  ON customer_service_transcripts(dealer_id);

CREATE INDEX IF NOT EXISTS idx_customer_service_transcripts_service_center
  ON customer_service_transcripts(service_center_id);

CREATE INDEX IF NOT EXISTS idx_customer_service_transcripts_date
  ON customer_service_transcripts(transcript_date DESC);

CREATE TABLE IF NOT EXISTS customer_service_transcript_analysis (
  analysis_id BIGSERIAL PRIMARY KEY,
  transcript_id BIGINT NOT NULL UNIQUE REFERENCES customer_service_transcripts(transcript_id) ON DELETE CASCADE,
  status VARCHAR(24) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  model_provider VARCHAR(40),
  model_name VARCHAR(80),
  model_version VARCHAR(80),
  sentiment VARCHAR(24) CHECK (sentiment IS NULL OR sentiment IN ('positive', 'neutral', 'negative', 'mixed')),
  sentiment_score NUMERIC(6, 4) CHECK (sentiment_score IS NULL OR (sentiment_score >= -1 AND sentiment_score <= 1)),
  primary_intent VARCHAR(120),
  issue_category VARCHAR(120),
  issue_subcategory VARCHAR(120),
  severity VARCHAR(24) CHECK (severity IS NULL OR severity IN ('low', 'medium', 'high', 'critical')),
  resolution_status VARCHAR(32) CHECK (resolution_status IS NULL OR resolution_status IN ('resolved', 'unresolved', 'pending', 'unknown')),
  escalation_risk VARCHAR(24) CHECK (escalation_risk IS NULL OR escalation_risk IN ('low', 'medium', 'high')),
  sla_breach_risk VARCHAR(24) CHECK (sla_breach_risk IS NULL OR sla_breach_risk IN ('low', 'medium', 'high')),
  customer_effort_score NUMERIC(6, 2) CHECK (customer_effort_score IS NULL OR (customer_effort_score >= 1 AND customer_effort_score <= 5)),
  summary TEXT,
  recommended_action TEXT,
  follow_up_required BOOLEAN NOT NULL DEFAULT FALSE,
  follow_up_due_date DATE,
  confidence_score NUMERIC(6, 4) CHECK (confidence_score IS NULL OR (confidence_score >= 0 AND confidence_score <= 1)),
  analysis_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  error_message TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customer_service_analysis_status
  ON customer_service_transcript_analysis(status);

CREATE INDEX IF NOT EXISTS idx_customer_service_analysis_category
  ON customer_service_transcript_analysis(issue_category, severity, escalation_risk);

CREATE TABLE IF NOT EXISTS customer_service_transcript_entities (
  entity_id BIGSERIAL PRIMARY KEY,
  transcript_id BIGINT NOT NULL REFERENCES customer_service_transcripts(transcript_id) ON DELETE CASCADE,
  entity_type VARCHAR(80) NOT NULL,
  entity_value TEXT NOT NULL,
  normalized_value TEXT,
  confidence_score NUMERIC(6, 4) CHECK (confidence_score IS NULL OR (confidence_score >= 0 AND confidence_score <= 1)),
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customer_service_entities_transcript
  ON customer_service_transcript_entities(transcript_id);

CREATE INDEX IF NOT EXISTS idx_customer_service_entities_type
  ON customer_service_transcript_entities(entity_type);

CREATE TABLE IF NOT EXISTS customer_service_transcript_actions (
  action_id BIGSERIAL PRIMARY KEY,
  transcript_id BIGINT NOT NULL REFERENCES customer_service_transcripts(transcript_id) ON DELETE CASCADE,
  action_type VARCHAR(80) NOT NULL,
  action_label TEXT NOT NULL,
  owner_team VARCHAR(80),
  due_date DATE,
  priority VARCHAR(24) NOT NULL DEFAULT 'medium'
    CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  status VARCHAR(24) NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'in_progress', 'completed', 'cancelled')),
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customer_service_actions_transcript
  ON customer_service_transcript_actions(transcript_id);

CREATE INDEX IF NOT EXISTS idx_customer_service_actions_status
  ON customer_service_transcript_actions(status, due_date);

CREATE TABLE IF NOT EXISTS customer_service_analysis_jobs (
  job_id BIGSERIAL PRIMARY KEY,
  transcript_id BIGINT NOT NULL REFERENCES customer_service_transcripts(transcript_id) ON DELETE CASCADE,
  status VARCHAR(24) NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts > 0),
  error_message TEXT,
  locked_at TIMESTAMPTZ,
  locked_by VARCHAR(120),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_by VARCHAR(80) REFERENCES users(username) ON UPDATE CASCADE ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customer_service_jobs_status
  ON customer_service_analysis_jobs(status, created_at);

CREATE INDEX IF NOT EXISTS idx_customer_service_jobs_transcript
  ON customer_service_analysis_jobs(transcript_id);

CREATE TABLE IF NOT EXISTS customer_service_audit_log (
  audit_id BIGSERIAL PRIMARY KEY,
  transcript_id BIGINT REFERENCES customer_service_transcripts(transcript_id) ON DELETE SET NULL,
  action VARCHAR(80) NOT NULL,
  actor_username VARCHAR(80) REFERENCES users(username) ON UPDATE CASCADE ON DELETE SET NULL,
  details JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customer_service_audit_transcript
  ON customer_service_audit_log(transcript_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_customer_service_audit_actor
  ON customer_service_audit_log(actor_username, created_at DESC);

INSERT INTO permissions (permission_name)
VALUES
  ('View Customer Service Transcripts'),
  ('Manage Customer Service Transcripts'),
  ('Analyze Customer Service Transcripts')
ON CONFLICT (permission_name) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM roles r
JOIN permissions p ON p.permission_name = 'View Customer Service Transcripts'
WHERE r.role_name IN ('Admin', 'National Head', 'Regional Head', 'Service Manager')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM roles r
JOIN permissions p ON p.permission_name IN ('Manage Customer Service Transcripts', 'Analyze Customer Service Transcripts')
WHERE r.role_name IN ('Admin', 'Service Manager')
ON CONFLICT DO NOTHING;

INSERT INTO user_access_scopes (username, domain, scope_type, scope_value)
SELECT username, 'Customer Service', scope_type, scope_value
FROM user_access_scopes
WHERE domain = 'Service'
ON CONFLICT (username, domain, scope_type, scope_value) DO NOTHING;

COMMIT;
