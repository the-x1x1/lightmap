/**
 * CI gate (plan §36): every provider id declared in code must have a row in
 * docs/DATA_SOURCES_AND_LICENSING.md and a non-empty attribution string (fixtures and the flat
 * ellipsoid excepted).
 */
import { readFileSync } from 'node:fs';
import { NOMINATIM_META } from '../packages/geospatial/src/providers/nominatim.ts';
import {
  CESIUM_ION_IMAGERY_META,
  CESIUM_ION_TERRAIN_META,
  NATURAL_EARTH_META,
  REEARTH_TERRAIN_META,
} from '../packages/geospatial/src/providers/map-sources.ts';
import { OPEN_METEO_CAPABILITIES } from '../packages/weather/src/providers/open-meteo.ts';

const doc = readFileSync('docs/DATA_SOURCES_AND_LICENSING.md', 'utf8');
const sources: Array<{ id: string; attribution: string }> = [
  NOMINATIM_META,
  REEARTH_TERRAIN_META,
  CESIUM_ION_TERRAIN_META,
  NATURAL_EARTH_META,
  CESIUM_ION_IMAGERY_META,
  { id: OPEN_METEO_CAPABILITIES.providerId, attribution: OPEN_METEO_CAPABILITIES.attribution },
  { id: 'geo-tz', attribution: 'timezone-boundary-builder' },
];
const problems: string[] = [];
for (const s of sources) {
  if (!s.attribution.trim()) problems.push(`${s.id}: empty attribution`);
  if (!doc.includes(`\`${s.id}\``))
    problems.push(`${s.id}: no row in docs/DATA_SOURCES_AND_LICENSING.md`);
}
if (problems.length) {
  console.error(`check-attribution:\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log(`check-attribution: ${sources.length} sources documented and attributed`);
