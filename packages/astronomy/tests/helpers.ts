/** IANA fixed-offset zone for a whole-hour UTC offset ("Etc/GMT+10" is UTC−10). */
export function etcZone(tzHours: number): string {
  if (tzHours === 0) return 'Etc/UTC';
  return `Etc/GMT${tzHours > 0 ? '-' : '+'}${Math.abs(tzHours)}`;
}
