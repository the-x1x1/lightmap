'use client';
/**
 * `/?viewpoint=<id>` opens a saved viewpoint in the planner (the shot list carries one link per
 * block): once the account is known and signed in, the viewpoint is fetched (owner-scoped, so a
 * stranger's link is a 404) and restored, and the parameter is dropped from the address so a
 * reload does not reopen it. The hook reports what happened so the shell can say so — a link to
 * a viewpoint that is not in this account, or one opened while signed out, must not fail silently.
 */
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/client/api';
import type { ViewpointDto } from '@/lib/api-types';
import { usePlannerStore } from '@/features/planner/store';
import { restoreInputFor, viewpointIdFromSearch } from './open-viewpoint.ts';

export type ViewpointLinkState =
  | { kind: 'none' }
  | { kind: 'sign-in' }
  | { kind: 'opening' }
  | { kind: 'opened'; label: string }
  | { kind: 'missing' };

function dropParam(): void {
  const url = new URL(window.location.href);
  url.searchParams.delete('viewpoint');
  window.history.replaceState(null, '', url.toString());
}

export function useViewpointLink(account: {
  signedIn: boolean;
  isLoading: boolean;
}): ViewpointLinkState {
  const [id, setId] = useState<string | null>(null);
  const restore = usePlannerStore((s) => s.restore);
  const setPanel = usePlannerStore((s) => s.setPanel);
  const openedId = useRef<string | null>(null);
  const [done, setDone] = useState<ViewpointLinkState | null>(null);

  useEffect(() => {
    setId(viewpointIdFromSearch(window.location.search));
  }, []);

  const q = useQuery({
    queryKey: ['viewpoints', id],
    queryFn: () => api.get<{ viewpoint: ViewpointDto }>(`/api/viewpoints/${id}`),
    enabled: Boolean(id) && account.signedIn,
    retry: 0,
    staleTime: Infinity,
  });

  useEffect(() => {
    if (!id || openedId.current === id) return;
    if (q.data) {
      openedId.current = id;
      restore(restoreInputFor(q.data.viewpoint));
      setPanel('plan');
      dropParam();
      setDone({ kind: 'opened', label: q.data.viewpoint.label });
    } else if (q.isError) {
      openedId.current = id;
      dropParam();
      setDone({ kind: 'missing' });
    }
  }, [id, q.data, q.isError, restore, setPanel]);

  if (!id) return { kind: 'none' };
  if (done) return done;
  if (account.isLoading) return { kind: 'opening' };
  if (!account.signedIn) return { kind: 'sign-in' };
  return { kind: 'opening' };
}
