-- LightMap 0005: when a profile was first changed by its user. Sign-up creates the profile row
-- (Auth.js `createUser`), so "a row exists" never meant "the user chose something": a device's
-- signed-out choices were never adopted on first sign-in. Rows that already differ from the
-- defaults, or were updated after creation, count as customised from their last update.
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS customized_at timestamptz;
UPDATE profiles
  SET customized_at = updated_at
  WHERE customized_at IS NULL
    AND (updated_at > created_at
      OR units <> 'metric'
      OR default_timezone_behavior <> 'location'
      OR default_lens_equivalent_mm <> 24
      OR painted_ground <> true);
