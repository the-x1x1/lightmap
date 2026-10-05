'use client';
/**
 * Offline project cache, client side (roadmap Phase 9): registers `public/sw.js` in production and
 * tells the UI when it is looking at cached data.
 */
import { useEffect, useState } from 'react';

export const SERVED_FROM_CACHE = 'lightmap:served-from-cache';
export const FRESH = 'lightmap:fresh';

/** Production, secure context, supporting browser only — dev keeps the network honest. */
export function registerServiceWorker(): void {
  if (process.env.NODE_ENV !== 'production') return;
  if (typeof window === 'undefined' || !window.isSecureContext) return;
  if (!('serviceWorker' in navigator)) return;
  const register = () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
      /* offline support is an extra; the app works without it */
    });
  };
  // After load, so the worker's install fetches never compete with the first paint.
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
}

export interface OfflineStatus {
  /** The browser reports no network. */
  offline: boolean;
  /** When the cached data now on screen was stored (ISO 8601), if any came from the cache. */
  cachedAt: string | null;
}

/**
 * "Offline" from the browser, plus the age of anything the service worker served from cache.
 * `cachedAt` clears as soon as the browser comes back online or the worker reports a fresh
 * response, so a single slow request never leaves the banner up for the session.
 */
export function useOfflineStatus(): OfflineStatus {
  const [offline, setOffline] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  useEffect(() => {
    const sync = () => {
      setOffline(!navigator.onLine);
      if (navigator.onLine) setCachedAt(null);
    };
    sync();
    window.addEventListener('online', sync);
    window.addEventListener('offline', sync);
    const sw = 'serviceWorker' in navigator ? navigator.serviceWorker : null;
    const onMessage = (e: MessageEvent) => {
      const d = e.data as { type?: unknown; cachedAt?: unknown } | null;
      if (d?.type === FRESH) {
        setCachedAt(null);
        return;
      }
      if (d?.type !== SERVED_FROM_CACHE) return;
      const at = typeof d.cachedAt === 'string' ? d.cachedAt : null;
      // Keep the oldest timestamp: the banner must not overstate how fresh the screen is.
      setCachedAt((prev) => (prev && at && prev < at ? prev : (at ?? prev)));
    };
    sw?.addEventListener('message', onMessage);
    return () => {
      window.removeEventListener('online', sync);
      window.removeEventListener('offline', sync);
      sw?.removeEventListener('message', onMessage);
    };
  }, []);
  return { offline, cachedAt };
}

/** "saved data from 14:05" / "saved data from 3 Oct, 14:05" — in the viewer's own clock. */
export function describeCachedAt(iso: string | null, now = new Date()): string | null {
  if (!iso) return null;
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return null;
  const time = t.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  const sameDay = t.toDateString() === now.toDateString();
  return sameDay
    ? `saved data from ${time}`
    : `saved data from ${t.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}, ${time}`;
}
