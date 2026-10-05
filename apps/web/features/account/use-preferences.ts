'use client';
/**
 * Preferences (plan §17): units, time-zone mode and the default lens. They live in the planner
 * store while the page is open, in local storage so a device keeps them between visits (signed
 * in or not), and in the profile once signed in, which wins over the local copy when it loads.
 */
import { useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { brand } from '@lightmap/config';
import { api } from '@/lib/client/api';
import type { ProfileResponse } from '@/lib/api-types';
import { DEFAULT_PREFERENCES, normalizePreferences, type Preferences } from '@/lib/preferences';
import { usePlannerStore } from '@/features/planner/store';
import { useAccount } from './use-account';

const STORAGE_KEY = `${brand.slug}:preferences`;
const PROFILE_KEY = ['account', 'profile'] as const;

export function loadLocalPreferences(): Preferences | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? normalizePreferences(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function saveLocalPreferences(p: Preferences): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
  } catch {
    // Private mode or a full quota: the session still has them in the store.
  }
}

/** On sign-out: the next account on this browser must not inherit these choices. */
export function clearLocalPreferences(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing stored, or storage unavailable.
  }
}

/** The current preferences as the planner holds them. */
export function usePreferences(): Preferences {
  const units = usePlannerStore((s) => s.units);
  const defaultTimezoneBehavior = usePlannerStore((s) => s.timeZoneMode);
  const defaultLensEquivalentMm = usePlannerStore((s) => s.defaultLensMm);
  return { units, defaultTimezoneBehavior, defaultLensEquivalentMm };
}

function samePreferences(a: Preferences, b: Preferences): boolean {
  return (
    a.units === b.units &&
    a.defaultTimezoneBehavior === b.defaultTimezoneBehavior &&
    a.defaultLensEquivalentMm === b.defaultLensEquivalentMm
  );
}

/**
 * Mount once (the shell): hydrates the store from local storage, then from the profile when
 * signed in. A profile nobody has changed yet (`customized: false`) does not override choices
 * made on this device while signed out — those are adopted into the account instead. Must run
 * after the first render so server and client markup agree.
 */
export function usePreferencesSync(): void {
  const account = useAccount();
  const qc = useQueryClient();
  const setPreferences = usePlannerStore((s) => s.setPreferences);
  const hydrated = useRef(false);
  useEffect(() => {
    if (hydrated.current) return;
    hydrated.current = true;
    const local = loadLocalPreferences();
    if (local) setPreferences(local);
  }, [setPreferences]);
  const profile = useQuery({
    queryKey: PROFILE_KEY,
    queryFn: () => api.get<ProfileResponse>('/api/account/profile'),
    enabled: account.signedIn,
    staleTime: 5 * 60_000,
    retry: 1,
  });
  const fromProfile = profile.data;
  useEffect(() => {
    if (!fromProfile) return;
    const p = normalizePreferences(fromProfile);
    const local = loadLocalPreferences();
    if (!fromProfile.customized && local && !samePreferences(local, DEFAULT_PREFERENCES)) {
      // First sign-in on a device with choices: the account takes them.
      setPreferences(local);
      void api
        .patch<ProfileResponse>('/api/account/profile', local)
        .then((saved) => qc.setQueryData(PROFILE_KEY, saved))
        .catch(() => {
          // Still applied locally; the next change will try the profile again.
        });
      return;
    }
    setPreferences(p);
    saveLocalPreferences(p);
  }, [fromProfile, qc, setPreferences]);
}

/** Which keys a patch touches, typed. */
function keysOf(patch: Partial<Preferences>): Array<keyof Preferences> {
  return (Object.keys(patch) as Array<keyof Preferences>).filter((k) => patch[k] !== undefined);
}

/**
 * Change preferences: applied to the planner at once; saved to the profile when signed in (and
 * rolled back if that fails), to this device otherwise. Saves can overlap (two quick choices, a
 * lens typed and retyped): each response is applied only for the keys it patched, and only when
 * no later save has touched the same key, so the planner ends on the newest choice whatever
 * order the responses arrive in.
 */
export function useUpdatePreferences() {
  const account = useAccount();
  const qc = useQueryClient();
  const setPreferences = usePlannerStore((s) => s.setPreferences);
  const current = usePreferences();
  /** Latest save sequence number per key. */
  const latest = useRef<Partial<Record<keyof Preferences, number>>>({});
  const seq = useRef(0);
  return useMutation({
    mutationFn: async (patch: Partial<Preferences>) => {
      const next: Preferences = { ...current, ...patch };
      if (!account.signedIn) return next;
      return normalizePreferences(await api.patch<ProfileResponse>('/api/account/profile', patch));
    },
    onMutate: (patch) => {
      const id = ++seq.current;
      for (const k of keysOf(patch)) latest.current[k] = id;
      const previous = current;
      const next: Preferences = { ...current, ...patch };
      setPreferences(next);
      saveLocalPreferences(next);
      return { previous, id };
    },
    onSuccess: (saved, patch, ctx) => {
      if (!ctx) return;
      // Take from the response only what this save asked for, and only if it is still the
      // newest word on those keys.
      const live = usePlannerStore.getState();
      const merged: Preferences = {
        units: live.units,
        defaultTimezoneBehavior: live.timeZoneMode,
        defaultLensEquivalentMm: live.defaultLensMm,
      };
      for (const k of keysOf(patch))
        if (latest.current[k] === ctx.id) merged[k] = saved[k] as never;
      setPreferences(merged);
      saveLocalPreferences(merged);
      if (account.signedIn) qc.setQueryData(PROFILE_KEY, { ...merged, customized: true });
    },
    onError: (_e, patch, ctx) => {
      if (!ctx) return;
      // Put back what this save changed, unless a newer save has since set the key.
      const live = usePlannerStore.getState();
      const restored: Preferences = {
        units: live.units,
        defaultTimezoneBehavior: live.timeZoneMode,
        defaultLensEquivalentMm: live.defaultLensMm,
      };
      for (const k of keysOf(patch))
        if (latest.current[k] === ctx.id) restored[k] = ctx.previous[k] as never;
      setPreferences(restored);
      saveLocalPreferences(restored);
    },
  });
}
