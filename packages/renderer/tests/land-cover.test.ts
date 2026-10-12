import { describe, expect, it } from 'vitest';
import {
  COVER_KNOWN_ALPHA,
  COVER_REACH_M,
  PALETTE_TOLERANCE,
  classifyCover,
  coverMapFromPixels,
  coverMosaicFor,
  latToTileY,
  lonToTileX,
  mercatorY,
  packCover,
  tileUrl,
  tileXToLon,
  tileYToLat,
} from '../src/land-cover.ts';

describe('land-cover classification', () => {
  it('maps the WorldCover legend colours to their classes, exactly and within tolerance', () => {
    expect(classifyCover([0, 100, 0], 'worldcover')).toBe('tree');
    expect(classifyCover([255, 187, 34], 'worldcover')).toBe('shrub');
    expect(classifyCover([255, 255, 76], 'worldcover')).toBe('grass');
    expect(classifyCover([240, 150, 255], 'worldcover')).toBe('crop');
    expect(classifyCover([250, 0, 0], 'worldcover')).toBe('built');
    expect(classifyCover([180, 180, 180], 'worldcover')).toBe('bare');
    expect(classifyCover([240, 240, 240], 'worldcover')).toBe('snow');
    expect(classifyCover([0, 100, 200], 'worldcover')).toBe('water');
    expect(classifyCover([0, 150, 160], 'worldcover')).toBe('wetland');
    expect(classifyCover([0, 207, 117], 'worldcover')).toBe('mangrove');
    expect(classifyCover([250, 230, 160], 'worldcover')).toBe('moss');
    // A resampled edge a few units off still classifies; a photograph's green does not.
    expect(classifyCover([6, 108, 4], 'worldcover')).toBe('tree');
    expect(classifyCover([90, 140, 60], 'worldcover')).toBeNull();
    expect(classifyCover([0, 100, 0], 'worldcover', 0)).toBeNull();
    expect(PALETTE_TOLERANCE).toBeLessThan(40);
  });

  it('knows the Copernicus forest shades as closed or open forest and its own water blue', () => {
    expect(classifyCover([0, 153, 0], 'copernicus')).toBe('tree');
    expect(classifyCover([88, 72, 31], 'copernicus')).toBe('tree');
    expect(classifyCover([141, 180, 0], 'copernicus')).toBe('open-forest');
    expect(classifyCover([102, 96, 0], 'copernicus')).toBe('open-forest');
    expect(classifyCover([0, 50, 200], 'copernicus')).toBe('water');
    expect(classifyCover([0, 0, 128], 'copernicus')).toBe('water');
    expect(classifyCover([250, 0, 0], 'copernicus')).toBe('built');
  });

  it('packs classes into the four channels the shader reads, with the known flag', () => {
    expect(packCover('tree')).toEqual([255, 0, 0, COVER_KNOWN_ALPHA]);
    expect(packCover('open-forest')).toEqual([204, 0, 0, COVER_KNOWN_ALPHA]);
    expect(packCover('crop')).toEqual([0, 0, 0, 255]);
    expect(packCover('built')).toEqual([0, 255, 0, COVER_KNOWN_ALPHA]);
    expect(packCover('bare')).toEqual([0, 0, 170, COVER_KNOWN_ALPHA]);
    expect(packCover('snow')).toEqual([0, 0, 255, COVER_KNOWN_ALPHA]);
    expect(packCover('grass')).toEqual([0, 0, 0, COVER_KNOWN_ALPHA]);
    expect(packCover('water')).toEqual([0, 0, 0, COVER_KNOWN_ALPHA]);
    expect(packCover(null)).toEqual([0, 0, 0, 0]);
  });

  it('builds a cover map from a mosaic: known share, class shares, unknown pixels transparent', () => {
    // 2 × 2: tree, crop, built, and a photograph-like unknown.
    const px = new Uint8ClampedArray([
      0, 100, 0, 255, 240, 150, 255, 255, 250, 0, 0, 255, 90, 140, 60, 255,
    ]);
    const m = coverMapFromPixels(px, 2, 2, 'worldcover');
    expect(m.width).toBe(2);
    expect(m.known).toBe(0.75);
    expect(m.shares).toEqual({ tree: 0.333, crop: 0.333, built: 0.333 });
    expect(Array.from(m.data)).toEqual([
      255,
      0,
      0,
      COVER_KNOWN_ALPHA,
      0,
      0,
      0,
      255,
      0,
      255,
      0,
      COVER_KNOWN_ALPHA,
      0,
      0,
      0,
      0,
    ]);
    // Transparent pixels (no tile) are unknown.
    const none = coverMapFromPixels(new Uint8ClampedArray([0, 100, 0, 0]), 1, 1, 'worldcover');
    expect(none.known).toBe(0);
    expect(coverMapFromPixels(new Uint8ClampedArray(0), 0, 0, 'worldcover').known).toBe(0);
  });
});

describe('tile arithmetic', () => {
  it('round-trips longitude/latitude through XYZ tile coordinates', () => {
    expect(lonToTileX(0, 1)).toBe(1);
    expect(latToTileY(0, 1)).toBeCloseTo(1, 9);
    expect(tileXToLon(lonToTileX(-157.73, 12), 12)).toBeCloseTo(-157.73, 9);
    expect(tileYToLat(latToTileY(21.4, 12), 12)).toBeCloseTo(21.4, 9);
    // Zurich at zoom 12 is the well-known tile 2144/1434.
    expect(Math.floor(lonToTileX(8.54, 12))).toBe(2145);
    expect(Math.floor(latToTileY(47.37, 12))).toBe(1434);
    expect(mercatorY(0)).toBeCloseTo(0, 12);
    expect(mercatorY(45)).toBeCloseTo(0.8814, 4);
  });

  it('chooses a mosaic that reaches 12 km each way: zoom 12 at the equator, 11 at 60° where tiles are narrower', () => {
    const eq = coverMosaicFor({ latitude: 0, longitude: 0 }, 14);
    expect(eq.zoom).toBe(12);
    expect(eq.x1 - eq.x0).toBe(2);
    expect(eq.metresPerPixel).toBeCloseTo(38.2, 0);
    // 1.5 tiles each way covers the reach.
    const tileM = eq.metresPerPixel * 256;
    expect(1.5 * tileM).toBeGreaterThanOrEqual(COVER_REACH_M);
    const north = coverMosaicFor({ latitude: 60, longitude: 10 }, 14);
    expect(north.zoom).toBe(11);
    // The provider's maximum caps it; the bounds come from the tile edges.
    const capped = coverMosaicFor({ latitude: 60, longitude: 10 }, 10);
    expect(capped.zoom).toBe(10);
    expect(capped.westRad).toBeLessThan((10 * Math.PI) / 180);
    expect(capped.eastRad).toBeGreaterThan((10 * Math.PI) / 180);
    expect(capped.northMerc).toBeGreaterThan(mercatorY(60));
    expect(capped.southMerc).toBeLessThan(mercatorY(60));
  });

  it('fills a tile URL template, wrapping x and honouring {-y}', () => {
    expect(tileUrl('https://t.example/{z}/{x}/{y}.png', 12, 2145, 1434)).toBe(
      'https://t.example/12/2145/1434.png',
    );
    expect(tileUrl('https://t.example/{z}/{x}/{y}.png', 2, -1, 1)).toBe(
      'https://t.example/2/3/1.png',
    );
    expect(tileUrl('https://t.example/{z}/{x}/{-y}.png', 2, 1, 1)).toBe(
      'https://t.example/2/1/2.png',
    );
  });
});
