'use client';
/**
 * Find a known place or coordinate (plan §4). Coordinates are parsed locally and never hit the
 * network; place names go through /api/location/search (rate-limited, cached). Debounced so typing
 * does not burst the geocoder policy. Not autocomplete-on-every-keystroke: 450 ms after typing stops.
 */
import { useEffect, useId, useRef, useState } from 'react';
import { parseCoordinates, type Place } from '@lightmap/geospatial';
import { usePlannerStore } from '@/features/planner/store';
import { api, ApiRequestError } from '@/lib/client/api';
import type { LocationSearchResponse, ReverseResponse } from '@/lib/api-types';
import { Button, cx } from '@lightmap/ui';

export function LocationSearch({ className, autoFocus }: { className?: string; autoFocus?: boolean }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Place[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attribution, setAttribution] = useState<string>('');
  const [active, setActive] = useState(-1);
  const setLocation = usePlannerStore((s) => s.setLocation);
  const listId = useId();
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setOpen(false);
      return;
    }
    const coords = parseCoordinates(q);
    if (coords) {
      setResults([{ label: `Coordinates ${coords.latitude.toFixed(5)}, ${coords.longitude.toFixed(5)}`, point: coords, sourceId: 'coordinates' }]);
      setOpen(true);
      setError(null);
      return;
    }
    const t = setTimeout(async () => {
      abort.current?.abort();
      const ac = new AbortController();
      abort.current = ac;
      setBusy(true);
      setError(null);
      try {
        const r = await api.get<LocationSearchResponse>(`/api/location/search?q=${encodeURIComponent(q)}`);
        if (ac.signal.aborted) return;
        setResults(r.results);
        setAttribution(r.provider.attribution);
        setOpen(true);
        setActive(r.results.length > 0 ? 0 : -1);
      } catch (e) {
        if (ac.signal.aborted) return;
        setResults([]);
        setError(e instanceof ApiRequestError && e.code === 'rate_limited' ? 'Searching too fast — try again in a moment, or paste coordinates.' : 'Place search is unavailable right now. Paste coordinates (e.g. 21.397, -157.727) to continue.');
        setOpen(true);
      } finally {
        if (!ac.signal.aborted) setBusy(false);
      }
    }, 450);
    return () => clearTimeout(t);
  }, [query]);

  async function choose(p: Place) {
    setOpen(false);
    setQuery(p.label);
    const deviceZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    setLocation({ point: p.point, timeZone: usePlannerStore.getState().location?.timeZone ?? deviceZone, label: p.label, source: p.sourceId === 'coordinates' ? 'coordinates' : 'search' });
    try {
      const r = await api.get<ReverseResponse>(`/api/location/reverse?lat=${p.point.latitude.toFixed(5)}&lng=${p.point.longitude.toFixed(5)}`);
      setLocation({ point: { ...p.point, ...(r.elevationM !== null ? { elevationM: r.elevationM } : {}) }, timeZone: r.timeZone, label: p.label, source: p.sourceId === 'coordinates' ? 'coordinates' : 'search' });
    } catch {
      /* time zone stays the device's; the badge shows which zone applies */
    }
  }

  function useDevice() {
    if (!('geolocation' in navigator)) return;
    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setBusy(false);
        void choose({ label: 'Current location', point: { latitude: pos.coords.latitude, longitude: pos.coords.longitude, ...(pos.coords.altitude !== null ? { elevationM: pos.coords.altitude } : {}) }, sourceId: 'device' });
      },
      () => {
        setBusy(false);
        setError('Location permission was not granted. Search or tap the map instead.');
        setOpen(true);
      },
      { enableHighAccuracy: false, timeout: 10_000 },
    );
  }

  return (
    <div className={cx('relative', className)}>
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => results.length > 0 && setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 120)}
            onKeyDown={(e) => {
              if (!open) return;
              if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(results.length - 1, a + 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
              else if (e.key === 'Enter' && active >= 0 && results[active]) { e.preventDefault(); void choose(results[active]!); }
              else if (e.key === 'Escape') setOpen(false);
            }}
            placeholder="Search a place or paste coordinates"
            aria-label="Search a place or paste coordinates"
            aria-autocomplete="list"
            aria-controls={listId}
            aria-expanded={open}
            role="combobox"
            autoComplete="off"
            autoFocus={autoFocus}
            data-testid="location-search"
            className="h-11 w-full rounded-[var(--lm-radius-sm)] border border-[var(--lm-panel-border)] bg-[var(--lm-panel-raised)] px-3 pr-9 text-sm text-[var(--lm-text)] placeholder:text-[var(--lm-text-faint)] focus:outline-none focus-visible:[box-shadow:var(--lm-focus)]"
          />
          {busy ? <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[var(--lm-text-faint)]" aria-live="polite">…</span> : null}
        </div>
        <Button variant="ghost" size="md" onClick={useDevice} aria-label="Use current location" title="Use current location (asks permission)">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /><circle cx="12" cy="12" r="8" /></svg>
        </Button>
      </div>
      {open ? (
        <ul id={listId} role="listbox" className="absolute left-0 right-0 top-full z-30 mt-1 max-h-72 overflow-auto rounded-[var(--lm-radius-sm)] border border-[var(--lm-panel-border)] bg-[var(--lm-panel-raised)] py-1 shadow-[var(--lm-shadow)]" data-testid="location-results">
          {error ? <li className="px-3 py-2 text-sm text-[color:#ffb3b3]" role="alert">{error}</li> : null}
          {results.map((r, i) => (
            <li key={`${r.sourceId ?? r.label}-${i}`} role="option" aria-selected={i === active}>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => void choose(r)} className={cx('block w-full px-3 py-2 text-left text-sm hover:bg-white/8', i === active && 'bg-white/8')}>
                <span className="block truncate">{r.label}</span>
                <span className="block text-xs text-[var(--lm-text-faint)]">{r.point.latitude.toFixed(4)}, {r.point.longitude.toFixed(4)}</span>
              </button>
            </li>
          ))}
          {!error && results.length === 0 && !busy ? <li className="px-3 py-2 text-sm text-[var(--lm-text-muted)]">No places found. Try a town name, or paste coordinates.</li> : null}
          {attribution ? <li className="px-3 pt-1 text-[10px] text-[var(--lm-text-faint)]">{attribution}</li> : null}
        </ul>
      ) : null}
    </div>
  );
}
