'use client';
/**
 * `/?viewpoint=<id>` opens a saved viewpoint in the planner (the shot list carries one link per
 * block): once the account is known and signed in, the viewpoint is fetched (owner-scoped, so a
 * stranger's link is a 404) and restored, and the parameter is dropped from the address so a
 * reload does not reopen it. Signed out, the link is left alone — sign in first.
 */
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/client/api';
import type { ViewpointDto } from '@/lib/api-types';
import { usePlannerStore } from '@/features/planner/store';
import { restoreInputFor, viewpointIdFromSearch } from './open-viewpoint.ts';

export function useViewpointLink(signedIn: boolean): void {
  const [id, setId] = useState<string | null>(null);
  const restore = usePlannerStore((s) => s.restore);
  const setPanel = usePlannerStore((s) => s.setPanel);
  const opened = useRef(false);

  useEffect(() => {
    setId(viewpointIdFromSearch(window.location.search));
  }, []);

  const q = useQuery({
    queryKey: ['viewpoints', id],
    queryFn: () => api.get<{ viewpoint: ViewpointDto }>(`/api/viewpoints/${id}`),
    enabled: Boolean(id) && signedIn,
    retry: 0,
    staleTime: Infinity,
  });

  useEffect(() => {
    if (!q.data || opened.current) return;
    opened.current = true;
    restore(restoreInputFor(q.data.viewpoint));
    setPanel('plan');
    const url = new URL(window.location.href);
    url.searchParams.delete('viewpoint');
    window.history.replaceState(null, '', url.toString());
  }, [q.data, restore, setPanel]);
}
