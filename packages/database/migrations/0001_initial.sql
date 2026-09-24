-- LightMap 0001: core schema (plan §17). Applied by packages/database/src/migrate.ts.
-- Everything runs in one transaction; identifiers are ULID/UUID text, never authorization.

CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  email text NOT NULL,
  email_verified timestamptz,
  display_name text,
  image text,
  deletion_requested_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_idx ON users (email);

CREATE TABLE IF NOT EXISTS accounts (
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type text NOT NULL,
  provider text NOT NULL,
  provider_account_id text NOT NULL,
  refresh_token text,
  access_token text,
  expires_at integer,
  token_type text,
  scope text,
  id_token text,
  session_state text,
  PRIMARY KEY (provider, provider_account_id)
);

CREATE TABLE IF NOT EXISTS sessions (
  session_token text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS verification_tokens (
  identifier text NOT NULL,
  token text NOT NULL,
  expires timestamptz NOT NULL,
  PRIMARY KEY (identifier, token)
);

CREATE TABLE IF NOT EXISTS profiles (
  user_id text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  units text NOT NULL DEFAULT 'metric' CHECK (units IN ('metric', 'imperial')),
  default_timezone_behavior text NOT NULL DEFAULT 'location' CHECK (default_timezone_behavior IN ('location', 'device')),
  default_lens_equivalent_mm integer NOT NULL DEFAULT 24,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS projects (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  shoot_date text,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS projects_user_idx ON projects (user_id);

CREATE TABLE IF NOT EXISTS viewpoints (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label text NOT NULL,
  latitude double precision NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude double precision NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  elevation_m double precision,
  timezone text NOT NULL,
  heading_deg double precision NOT NULL,
  pitch_deg double precision NOT NULL,
  field_of_view_deg double precision NOT NULL,
  focal_length_equivalent_mm double precision,
  selected_datetime_utc timestamptz NOT NULL,
  weather_mode text NOT NULL CHECK (weather_mode IN ('FORECAST', 'EXTENDED_FORECAST', 'SCENARIO', 'RECENT_PAST', 'PAST')),
  weather_scenario text,
  preview_source_type text NOT NULL CHECK (preview_source_type IN ('REAL_REFERENCE', 'SIMULATED_LIGHTING', 'ESTIMATED_PREVIEW')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS viewpoints_project_idx ON viewpoints (project_id);
CREATE INDEX IF NOT EXISTS viewpoints_user_idx ON viewpoints (user_id);

CREATE TABLE IF NOT EXISTS preview_snapshots (
  id text PRIMARY KEY,
  viewpoint_id text NOT NULL REFERENCES viewpoints(id) ON DELETE CASCADE,
  generated_at timestamptz NOT NULL DEFAULT now(),
  source_type text NOT NULL,
  provider_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  astronomy_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  weather_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  confidence_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  thumbnail_storage_key text,
  thumbnail_data_url text
);
CREATE INDEX IF NOT EXISTS preview_snapshots_viewpoint_idx ON preview_snapshots (viewpoint_id);

CREATE TABLE IF NOT EXISTS subscriptions (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'stripe',
  provider_customer_id text NOT NULL,
  provider_subscription_id text,
  status text NOT NULL,
  plan_key text NOT NULL,
  price_id text,
  period_start timestamptz,
  period_end timestamptz,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_user_idx ON subscriptions (user_id);
CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_customer_idx ON subscriptions (provider_customer_id);
CREATE INDEX IF NOT EXISTS subscriptions_provider_sub_idx ON subscriptions (provider_subscription_id);

CREATE TABLE IF NOT EXISTS subscription_events (
  id text PRIMARY KEY,
  provider text NOT NULL DEFAULT 'stripe',
  provider_event_id text NOT NULL,
  type text NOT NULL,
  user_id text,
  payload jsonb NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now(),
  outcome text NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS subscription_events_provider_event_idx ON subscription_events (provider, provider_event_id);

CREATE TABLE IF NOT EXISTS provider_cache (
  namespace text NOT NULL,
  cache_key text NOT NULL,
  payload jsonb NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (namespace, cache_key)
);
CREATE INDEX IF NOT EXISTS provider_cache_expires_idx ON provider_cache (expires_at);

CREATE TABLE IF NOT EXISTS audit_events (
  id text PRIMARY KEY,
  user_id text,
  action text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_events_user_idx ON audit_events (user_id);
CREATE INDEX IF NOT EXISTS audit_events_created_idx ON audit_events (created_at);

CREATE TABLE IF NOT EXISTS usage_counters (
  user_key text NOT NULL,
  day text NOT NULL,
  resource text NOT NULL,
  count integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_key, day, resource)
);
