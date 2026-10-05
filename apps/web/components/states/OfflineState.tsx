'use client';
/**
 * One banner for the network: offline, or online but showing data the service worker served from
 * its cache (Phase 9 offline project cache). Always mounted so the status region announces changes
 * (plan §28); the visible pill appears only when there is something to say.
 */
import { describeCachedAt, useOfflineStatus } from '@/lib/client/offline';

export function OfflineState() {
  const { offline, cachedAt } = useOfflineStatus();
  const age = describeCachedAt(cachedAt);
  const show = offline || age !== null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 top-2 z-50 flex justify-center px-4"
      data-testid="offline-status"
    >
      {show ? (
        <p
          className="max-w-full rounded-2xl bg-[var(--lm-panel-raised)] px-3 py-1.5 text-center text-xs text-[var(--lm-text)] ring-1 ring-white/15"
          data-testid="offline-banner"
        >
          {offline ? 'Offline' : 'Connection problem'}
          {age ? ` · ${age}` : ''}
          <span className="hidden sm:inline">
            {' '}
            — sun and moon still work; forecasts and saving resume when you reconnect.
          </span>
        </p>
      ) : null}
    </div>
  );
}
