'use client';
/** Fixture/limited mode is never disguised as live (plan §33). */
import type { CapabilitiesResponse } from '@/lib/api-types';

export function DevBanner({ caps }: { caps: CapabilitiesResponse | null }) {
  if (!caps || !caps.devBanner || !caps.fixtureMode) return null;
  const parts: string[] = [];
  if (caps.weather?.isFixture) parts.push('fixture weather');
  if (caps.providers.geocoderIsFixture) parts.push('fixture place search');
  if (caps.providers.basemap.detailLevel === 'coarse')
    parts.push('coarse basemap (no imagery key)');
  if (caps.providers.terrain.kind === 'ellipsoid') parts.push('no terrain');
  return (
    <div
      role="status"
      className="pointer-events-none fixed inset-x-0 top-0 z-40 flex justify-center px-2 pt-1"
    >
      <span
        className="rounded-b-md bg-[color:rgba(245,179,66,0.9)] px-2 py-0.5 text-[11px] font-medium text-[#1a1200]"
        data-testid="dev-banner"
      >
        Development mode — {parts.length ? parts.join(', ') : 'limited providers'}. Not live data.
      </span>
    </div>
  );
}
