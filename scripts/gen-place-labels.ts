/**
 * Place labels for the globe (`apps/web/public/data/place-labels.json`): towns and cities from
 * Natural Earth's 1:10m populated places and country names from its 1:110m admin-0 countries,
 * both public domain (naturalearthdata.com/about/terms-of-use). The output is compact and
 * committed; re-run after changing the selection:
 *
 *   git clone --depth 1 --filter=blob:none --no-checkout https://github.com/nvkelso/natural-earth-vector ne
 *   (cd ne && git sparse-checkout set --no-cone /geojson/ne_10m_populated_places_simple.geojson /geojson/ne_110m_admin_0_countries.geojson && git checkout)
 *   pnpm labels:places ne/geojson
 *
 * Each place keeps its name, position (3 decimals ≈ 100 m), Natural Earth's `min_zoom` (the web
 * map zoom from which a cartographer would label it — the renderer turns it into a camera
 * distance) and whether it is a national capital.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const dir = process.argv[2];
if (!dir) {
  console.error('usage: gen-place-labels <natural-earth geojson directory>');
  process.exit(1);
}
const OUT = join(process.cwd(), 'apps/web/public/data/place-labels.json');
/** Natural Earth scale ranks kept: 0 (world cities) to 7 (towns of regional note), ~5 500 places. */
const MAX_SCALERANK = 7;

interface Feature {
  properties: Record<string, unknown>;
}
const read = (file: string) =>
  (JSON.parse(readFileSync(join(dir, file), 'utf8')) as { features: Feature[] }).features;

const r3 = (x: number) => Math.round(x * 1000) / 1000;
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);

const places: Array<[string, number, number, number, 0 | 1]> = [];
for (const f of read('ne_10m_populated_places_simple.geojson')) {
  const p = f.properties;
  const rank = num(p['scalerank']);
  const lat = num(p['latitude']);
  const lon = num(p['longitude']);
  const zoom = num(p['min_zoom']);
  // Some names carry stray format characters (a left-to-right mark after "Granada").
  const name = str(p['name'])?.replace(/[‎‏‪-‮]/g, '');
  if (rank === null || rank > MAX_SCALERANK || lat === null || lon === null || zoom === null)
    continue;
  if (!name) continue;
  places.push([name, r3(lat), r3(lon), Math.round(zoom * 10) / 10, p['adm0cap'] ? 1 : 0]);
}
// Most prominent first: the renderer adds them in this order.
places.sort((a, b) => a[3] - b[3] || b[4] - a[4] || a[0].localeCompare(b[0]));

const countries: Array<[string, number, number, number]> = [];
for (const f of read('ne_110m_admin_0_countries.geojson')) {
  const p = f.properties;
  const name = str(p['NAME_EN']) ?? str(p['NAME']);
  const lon = num(p['LABEL_X']);
  const lat = num(p['LABEL_Y']);
  const min = num(p['MIN_LABEL']);
  if (!name || lat === null || lon === null || min === null) continue;
  countries.push([name, r3(lat), r3(lon), Math.round(min * 10) / 10]);
}
countries.sort((a, b) => a[3] - b[3] || a[0].localeCompare(b[0]));

mkdirSync(dirname(OUT), { recursive: true });
const json = JSON.stringify({
  v: 1,
  source:
    'Natural Earth 1:10m populated places and 1:110m admin-0 countries (public domain, naturalearthdata.com)',
  places,
  countries,
});
writeFileSync(OUT, json + '\n');
console.log(
  `wrote ${OUT}: ${places.length} places, ${countries.length} countries, ${(json.length / 1024).toFixed(0)} KB`,
);
