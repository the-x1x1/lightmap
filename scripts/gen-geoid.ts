/**
 * Sea level for the ground texture (`apps/web/public/data/geoid/`): the EGM96 geoid's height
 * above the WGS84 ellipsoid on its 15′ grid (NGA, US Government work, public domain), cut into
 * 30° cells so the browser fetches only the one around a pin. Terrain heights are ellipsoidal;
 * the shader's shore and water-edge rules need sea level, which sits as much as ±100 m off the
 * ellipsoid (Honolulu +15 m, Washington D.C. −33 m).
 *
 * Source: NGA's `WW15MGH.DAC` (721 rows from 90°N to 90°S × 1440 columns from 0°E eastward,
 * big-endian int16 in centimetres), e.g. as redistributed in TerriaJS
 * (`packages/terriajs/wwwroot/data/WW15MGH.DAC`):
 *
 *   pnpm geoid path/to/WW15MGH.DAC
 *
 * Cell file `<latIndex>_<lonIndex>.bin` (index = floor(degrees / 30), longitude in −180…180):
 * 121 × 121 little-endian int16 heights in decimetres, row 0 at the cell's north edge, column 0
 * at its west edge, 0.25° apart (edges included, so a cell interpolates on its own).
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const src = process.argv[2];
if (!src) {
  console.error('usage: gen-geoid <WW15MGH.DAC>');
  process.exit(1);
}
const OUT = join(process.cwd(), 'apps/web/public/data/geoid');
const COLS = 1440;
const ROWS = 721;
const dac = readFileSync(src);
if (dac.length !== COLS * ROWS * 2) {
  console.error(`unexpected size ${dac.length} (want ${COLS * ROWS * 2})`);
  process.exit(1);
}
/** Geoid height in centimetres at grid row r (0 = 90°N) and column c (0 = 0°E, wraps). */
const at = (r: number, c: number) => dac.readInt16BE((r * COLS + (((c % COLS) + COLS) % COLS)) * 2);

const CELL = 30;
const N = CELL * 4 + 1;
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
let files = 0;
for (let li = -3; li < 3; li++)
  for (let oi = -6; oi < 6; oi++) {
    const out = Buffer.alloc(N * N * 2);
    const north = (li + 1) * CELL;
    const west = oi * CELL;
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const r = (90 - north) * 4 + y;
        const c = west * 4 + x;
        out.writeInt16LE(Math.round(at(r, c) / 10), (y * N + x) * 2);
      }
    writeFileSync(join(OUT, `${li}_${oi}.bin`), out);
    files++;
  }
console.log(`wrote ${files} cells of ${N} x ${N} to ${OUT}`);
