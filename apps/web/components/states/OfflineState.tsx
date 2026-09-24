'use client';
import { useEffect, useState } from 'react';

/** Shown when the browser is offline: astronomy keeps working; forecasts and saving pause. */
export function OfflineState() {
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  if (!offline) return null;
  return (
    <div
      role="status"
      className="fixed left-1/2 top-2 z-50 -translate-x-1/2 rounded-full bg-[var(--lm-panel-raised)] px-3 py-1.5 text-xs text-[var(--lm-text)] ring-1 ring-white/15"
    >
      Offline — sun and moon still work; forecasts and saving will resume when you reconnect.
    </div>
  );
}
