'use client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SessionProvider } from 'next-auth/react';
import { useState } from 'react';

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { refetchOnWindowFocus: false, retry: 1, staleTime: 30_000 } },
      }),
  );
  return (
    <SessionProvider refetchOnWindowFocus={false}>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </SessionProvider>
  );
}
