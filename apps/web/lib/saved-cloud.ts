/**
 * The total cloud cover the viewpoint was saved under, from the snapshot's weather state (the
 * frame in force for a forecast or observed day): a whole percent, or null for a scenario day
 * or an older snapshot without a frame.
 */
export function cloudCoverAtSave(weatherState: unknown): number | null {
  if (typeof weatherState !== 'object' || weatherState === null) return null;
  const frame = (weatherState as { frame?: unknown }).frame;
  if (typeof frame !== 'object' || frame === null) return null;
  const cover = (frame as { cloudCoverTotal?: unknown }).cloudCoverTotal;
  return typeof cover === 'number' && Number.isFinite(cover)
    ? Math.round(Math.max(0, Math.min(100, cover)))
    : null;
}
