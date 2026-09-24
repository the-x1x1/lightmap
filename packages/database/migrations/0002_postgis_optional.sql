-- LightMap 0002: PostGIS geography point on viewpoints (plan §17 "where useful").
-- Optional: skipped with a NOTICE when the PostGIS extension is not available on this server
-- (common in local dev). Production must have PostGIS (docs/RELEASE_PROCESS.md pre-flight).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'postgis') THEN
    CREATE EXTENSION IF NOT EXISTS postgis;
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns WHERE table_name = 'viewpoints' AND column_name = 'location'
    ) THEN
      ALTER TABLE viewpoints
        ADD COLUMN location geography(Point, 4326)
        GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography) STORED;
      CREATE INDEX viewpoints_location_gix ON viewpoints USING GIST (location);
    END IF;
  ELSE
    RAISE NOTICE 'PostGIS not available: viewpoints.location skipped (lat/lng columns remain authoritative)';
  END IF;
END $$;
