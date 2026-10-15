/**
 * The zone a newly picked place reads in until the reverse lookup answers (or when it cannot,
 * offline): the previous place's zone if the new one is near it (a walk, a nearby click), else
 * the nautical zone of its longitude (`Etc/GMT-9` for Tokyo's 139.7° E), which is within an hour
 * of the true one almost everywhere. Never the previous place's zone across the world: Tokyo's
 * zone on Kiritimati was a whole day off.
 */
export function provisionalTimeZone(
  point: { latitude: number; longitude: number },
  previous: { point: { latitude: number; longitude: number }; timeZone: string } | null,
): string {
  if (previous && distanceKm(point, previous.point) < 150) return previous.timeZone;
  const lon = ((((point.longitude + 180) % 360) + 360) % 360) - 180;
  const hours = Math.max(-12, Math.min(12, Math.round(lon / 15)));
  if (hours === 0) return 'Etc/GMT';
  // The Etc zones' signs are POSIX-style, the reverse of the usual: Etc/GMT-9 is UTC+9.
  return `Etc/GMT${hours > 0 ? '-' : '+'}${Math.abs(hours)}`;
}

function distanceKm(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const r = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * r;
  const dLon = (b.longitude - a.longitude) * r;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.latitude * r) * Math.cos(b.latitude * r) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Whether the planner still stands where a lookup was asked for (a later pick supersedes it). */
export function samePoint(
  a: { latitude: number; longitude: number } | null | undefined,
  b: { latitude: number; longitude: number },
): boolean {
  return (
    !!a && Math.abs(a.latitude - b.latitude) < 1e-9 && Math.abs(a.longitude - b.longitude) < 1e-9
  );
}
