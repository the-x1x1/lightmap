-- LightMap 0003: shot variants (plan §25 Phase 6 "saved shot variants").
-- A variant is a viewpoint that shares its parent's place and camera and differs in date/time
-- and weather scenario. Deleting the parent deletes its variants. Variants count toward the
-- plan's viewpoint limits like any other viewpoint (no hidden quota).
ALTER TABLE viewpoints
  ADD COLUMN IF NOT EXISTS parent_viewpoint_id text REFERENCES viewpoints(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS viewpoints_parent_idx ON viewpoints (parent_viewpoint_id);
