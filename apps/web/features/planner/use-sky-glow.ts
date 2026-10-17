'use client';
/**
 * City glow at the selected place (`skyGlowAt`), from the bundled urban-area cells around it:
 * fetched once per cell and kept for the page's life, recomputed when the place moves by more
 * than about a kilometre. Null until the cells have answered, and when they cannot be read.
 */
import { useEffect, useState } from 'react';
import {
  SKY_GLOW_REACH_KM,
  decodeUrbanCell,
  skyGlowAt,
  urbanCellsFor,
  type SkyGlow,
  type UrbanPolygon,
} from '@lightmap/renderer';
import { URBAN_AREAS_URL } from '@/features/map/use-renderer';

let index: Promise<Set<string> | null> | null = null;
const cells = new Map<string, Promise<UrbanPolygon[]>>();

function cellIndex(): Promise<Set<string> | null> {
  index ??= fetch(`${URBAN_AREAS_URL}/index.json`)
    .then((r) => (r.ok ? (r.json() as Promise<{ cells?: unknown }>) : null))
    .then((j) =>
      j && Array.isArray(j.cells)
        ? new Set(j.cells.filter((c): c is string => typeof c === 'string'))
        : null,
    )
    .catch(() => null)
    .then((set) => {
      if (!set) index = null; // try again on the next place
      return set;
    });
  return index;
}

function cell(key: string): Promise<UrbanPolygon[]> {
  let c = cells.get(key);
  if (!c) {
    c = fetch(`${URBAN_AREAS_URL}/${key}.json`)
      .then((r) => (r.ok ? (r.json() as Promise<unknown>) : null))
      .then((j) => decodeUrbanCell(j, key))
      .catch(() => {
        cells.delete(key);
        return [];
      });
    cells.set(key, c);
  }
  return c;
}

/** The polygons whose cells lie within the glow's reach of a place. */
async function polygonsAround(lat: number, lon: number): Promise<UrbanPolygon[] | null> {
  const known = await cellIndex();
  if (!known) return null;
  const dLat = SKY_GLOW_REACH_KM / 111;
  const dLon = dLat / Math.max(0.1, Math.cos((lat * Math.PI) / 180));
  const keys = urbanCellsFor({
    west: lon - dLon,
    east: lon + dLon,
    south: Math.max(-90, lat - dLat),
    north: Math.min(90, lat + dLat),
  }).filter((k) => known.has(k));
  return (await Promise.all(keys.map(cell))).flat();
}

/** `enabled` false (the night section closed) fetches nothing. */
export function useSkyGlow(lat: number, lng: number, enabled = true): SkyGlow | null {
  // About a kilometre: a drag of the pin along a street does not refetch or recompute.
  const qLat = Math.round(lat * 100) / 100;
  const qLng = Math.round(lng * 100) / 100;
  const [glow, setGlow] = useState<{ key: string; value: SkyGlow } | null>(null);
  const key = `${qLat},${qLng}`;
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    void polygonsAround(qLat, qLng).then((polys) => {
      if (live && polys) setGlow({ key, value: skyGlowAt(qLat, qLng, polys) });
    });
    return () => {
      live = false;
    };
  }, [enabled, key, qLat, qLng]);
  return glow?.key === key ? glow.value : null;
}
