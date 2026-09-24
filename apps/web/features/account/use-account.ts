'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { can, type EntitlementContext, type EntitlementDecision, type EntitlementKey } from '@lightmap/entitlements';
import { api } from '@/lib/client/api';
import type { EntitlementsResponse } from '@/lib/api-types';

/** Server-derived entitlement snapshot; the client never decides plans itself. */
export function useAccount() {
  const q = useQuery({ queryKey: ['account'], queryFn: () => api.get<EntitlementsResponse>('/api/account/entitlements'), staleTime: 60_000, retry: 1 });
  const snapshot = q.data?.entitlements ?? null;
  return {
    ...q,
    signedIn: q.data?.signedIn ?? false,
    user: q.data?.user ?? null,
    snapshot,
    subscription: q.data?.subscription ?? null,
    can(key: EntitlementKey, ctx?: EntitlementContext): EntitlementDecision {
      if (!snapshot) return { allowed: false, key, reason: 'Loading your plan…' };
      return can(snapshot, key, ctx);
    },
  };
}

export function useCheckout() {
  return useMutation({
    mutationFn: (interval: 'monthly' | 'yearly') => api.post<{ url: string }>('/api/billing/checkout', { interval }),
    onSuccess: (r) => {
      window.location.href = r.url;
    },
  });
}

export function usePortal() {
  return useMutation({
    mutationFn: () => api.post<{ url: string }>('/api/billing/portal', {}),
    onSuccess: (r) => {
      window.location.href = r.url;
    },
  });
}

export function useDeleteAccount() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: () => api.post<{ ok: boolean; erasesAfterDays: number }>('/api/account/delete', {}), onSuccess: () => void qc.invalidateQueries({ queryKey: ['account'] }) });
}
