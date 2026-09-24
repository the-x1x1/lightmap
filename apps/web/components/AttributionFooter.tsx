/** Attribution is mandatory for every data source on screen (plan §7, §14). */
import type { CapabilitiesResponse } from '@/lib/api-types';
import type { SceneState } from '@lightmap/scene';

export function AttributionFooter({ caps, scene }: { caps: CapabilitiesResponse | null; scene: SceneState | null }) {
  const items = new Map<string, { text: string; url?: string }>();
  for (const a of caps?.providers.attributions ?? []) items.set(a.id, { text: a.attribution, ...(a.attributionUrl ? { url: a.attributionUrl } : {}) });
  if (scene?.atmosphere.providerAttribution) items.set('weather', { text: scene.atmosphere.providerAttribution });
  if (items.size === 0) return null;
  return (
    <footer className="border-t border-[var(--lm-panel-border)] px-4 py-2 text-[10px] leading-relaxed text-[var(--lm-text-faint)]" data-testid="attribution">
      {[...items.values()].map((a, i) => (
        <span key={a.text}>
          {i > 0 ? ' · ' : ''}
          {a.url ? <a href={a.url} target="_blank" rel="noopener noreferrer" className="underline-offset-2 hover:underline">{a.text}</a> : a.text}
        </span>
      ))}
      <span> · Ephemeris: LightMap (Meeus / Astronomical Almanac)</span>
    </footer>
  );
}
