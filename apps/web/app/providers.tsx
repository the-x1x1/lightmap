'use client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SessionProvider } from 'next-auth/react';
import { useEffect, useState } from 'react';
import { registerServiceWorker } from '@/lib/client/offline';

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            refetchOnWindowFocus: false,
            retry: 1,
            staleTime: 30_000,
            // Keep fetching when the browser says it is offline: the service worker answers
            // saved-project reads from its cache (Phase 9), and a paused query would never ask.
            networkMode: 'offlineFirst',
          },
        },
      }),
  );
  useEffect(() => registerServiceWorker(), []);
  return (
    <SessionProvider refetchOnWindowFocus={false}>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </SessionProvider>
  );
}
