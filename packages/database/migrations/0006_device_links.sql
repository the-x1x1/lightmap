-- LightMap 0006: the desktop apps sign in through the browser. The app asks for a link (a short
-- code it shows and a poll secret it keeps), the person approves the code on the website while
-- signed in, and the app's next poll trades the secret for a device token once. Only hashes of
-- the secret and the token are stored. A token is revoked by its user (or by signing out on the
-- device), and goes with the account.
CREATE TABLE IF NOT EXISTS device_links (
  id text PRIMARY KEY,
  code text NOT NULL,
  poll_hash text NOT NULL,
  device_name text NOT NULL,
  user_id text REFERENCES users(id) ON DELETE CASCADE,
  approved_at timestamptz,
  consumed_at timestamptz,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS device_links_code_idx ON device_links (code);
CREATE UNIQUE INDEX IF NOT EXISTS device_links_poll_idx ON device_links (poll_hash);
CREATE INDEX IF NOT EXISTS device_links_expires_idx ON device_links (expires_at);

CREATE TABLE IF NOT EXISTS device_tokens (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  device_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS device_tokens_hash_idx ON device_tokens (token_hash);
CREATE INDEX IF NOT EXISTS device_tokens_user_idx ON device_tokens (user_id);
