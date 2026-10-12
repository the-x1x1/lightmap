-- LightMap 0004: the "painted ground" preference (texture pack): whether the procedural ground
-- texture (and the land cover and detail atlas with it) is drawn over the basemap. On by
-- default; off shows the bare basemap under the real light — the plain map some photographers
-- prefer, and the quickest way to tell the texture from the imagery.
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS painted_ground boolean NOT NULL DEFAULT true;
