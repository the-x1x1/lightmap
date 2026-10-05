'use client';
/** Says plainly when the planner is offline or showing cached projects (Phase 9 offline cache). */
import { describeCachedAt, useOfflineStatus } from '@/lib/client/offline';

export function OfflineBanner() {
  const { offline, cachedAt } = useOfflineStatus();
  const age = describeCachedAt(cachedAt);
  const show = offline || age !== null;
  return (
    // Always mounted so the status region announces changes (plan §28).
    <div role="status" aria-live="polite" className="contents" data-testid="offline-status">
      {show ? (
        <p
          className="pointer-events-none absolute left-1/2 top-[6.75rem] z-20 w-max max-w-[calc(100%-2rem)] -translate-x-1/2 rounded-2xl bg-black/75 px-3 py-1.5 text-center text-xs text-[var(--lm-text)] lg:top-[7.5rem]"
          data-testid="offline-banner"
        >
          {offline ? 'Offline' : 'Connection problem'}
          {age ? ` · ${age}` : ''} · sun & moon still work; weather uses scenarios; saving needs a
          connection
        </p>
      ) : null}
    </div>
  );
}
