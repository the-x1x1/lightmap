/**
 * Built-up areas for the ground texture when no land-cover source is configured
 * (`apps/web/public/data/urban/`): Natural Earth's 1:10m urban areas (public domain;
 * naturalearthdata.com/about/terms-of-use), simplified to ~20 m and cut into 10° cells so the
 * browser fetches only the cell or two around a pin. The renderer rasterises them into the
 * ground material's cover map as built-up ground, so a city reads as a city rather than as turf.
 *
 *   git clone --depth 1 --filter=blob:none --no-checkout https://github.com/nvkelso/natural-earth-vector ne
 *   (cd ne && git sparse-checkout set --no-cone /geojson/ne_10m_urban_areas.geojson && git checkout)
 *   pnpm urban:areas ne/geojson
 *
 * Cell file `<latIndex>_<lonIndex>.json` (index = floor(degrees / 10)):
 * `{ "v": 1, "q": 10000, "polys": [[ring, …], …] }`, each ring a flat list of integers — the
 * first vertex in 1/10 000° from the cell's south-west corner, the rest as deltas — and
 * `index.json` lists the cells that exist.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
if (!dir) {
  console.error('usage: gen-urban-areas <natural-earth geojson directory>');
  process.exit(1);
}
const OUT = join(process.cwd(), 'apps/web/public/data/urban');
const Q = 10_000;
/** Douglas–Peucker tolerance, degrees (≈ 20 m). */
const TOLERANCE = 0.0002;

type Pt = [number, number];

function simplify(points: Pt[], tol: number): Pt[] {
  if (points.length <= 4) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const [ax, ay] = points[a]!;
    const [bx, by] = points[b]!;
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy) || 1e-12;
    let worst = -1;
    let at = -1;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = points[i]!;
      const d = Math.abs(dy * (px - ax) - dx * (py - ay)) / len;
      if (d > worst) {
        worst = d;
        at = i;
      }
    }
    if (worst > tol && at > 0) {
      keep[at] = 1;
      stack.push([a, at], [at, b]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/** A closed ring (first point repeated last) simplified in two halves, so its ends never meet in a zero-length chord. */
function simplifyRing(ring: Pt[]): Pt[] {
  if (ring.length < 8) return ring;
  const mid = Math.floor(ring.length / 2);
  const a = simplify(ring.slice(0, mid + 1), TOLERANCE);
  const b = simplify(ring.slice(mid), TOLERANCE);
  return [...a, ...b.slice(1)];
}

const data = JSON.parse(readFileSync(join(dir, 'ne_10m_urban_areas.geojson'), 'utf8')) as {
  features: Array<{ geometry: { type: string; coordinates: unknown } }>;
};
const cells = new Map<string, number[][][]>();
let rings = 0;
let points = 0;
for (const f of data.features) {
  const g = f.geometry;
  const polys = (g.type === 'MultiPolygon' ? g.coordinates : [g.coordinates]) as Pt[][][];
  for (const poly of polys) {
    let w = Infinity;
    let e = -Infinity;
    let s = Infinity;
    let n = -Infinity;
    for (const [lon, lat] of poly[0] ?? []) {
      w = Math.min(w, lon);
      e = Math.max(e, lon);
      s = Math.min(s, lat);
      n = Math.max(n, lat);
    }
    if (!Number.isFinite(w)) continue;
    const simplified = poly.map(simplifyRing).filter((r) => r.length >= 4);
    if (simplified.length === 0) continue;
    for (let li = Math.floor(s / 10); li <= Math.floor(n / 10); li++)
      for (let oi = Math.floor(w / 10); oi <= Math.floor(e / 10); oi++) {
        const key = `${li}_${oi}`;
        const lat0 = li * 10;
        const lon0 = oi * 10;
        const encoded = simplified.map((r) => {
          const out: number[] = [];
          let px = 0;
          let py = 0;
          r.forEach(([lon, lat], i) => {
            const x = Math.round((lon - lon0) * Q);
            const y = Math.round((lat - lat0) * Q);
            if (i === 0) out.push(x, y);
            else out.push(x - px, y - py);
            px = x;
            py = y;
          });
          rings++;
          points += r.length;
          return out;
        });
        const list = cells.get(key) ?? [];
        list.push(encoded);
        cells.set(key, list);
      }
  }
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
let bytes = 0;
let largest = 0;
for (const [key, polys] of cells) {
  const json = JSON.stringify({ v: 1, q: Q, polys });
  writeFileSync(join(OUT, `${key}.json`), json);
  bytes += json.length;
  largest = Math.max(largest, json.length);
}
writeFileSync(
  join(OUT, 'index.json'),
  JSON.stringify({
    v: 1,
    source: 'Natural Earth 1:10m urban areas (public domain, naturalearthdata.com)',
    cells: [...cells.keys()].sort(),
  }),
);
console.log(
  `wrote ${cells.size} cells, ${rings} rings, ${points} points, ${(bytes / 1024).toFixed(0)} KB (largest ${(largest / 1024).toFixed(0)} KB)`,
);
