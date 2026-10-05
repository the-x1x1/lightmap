'use client';
/**
 * PWA install (roadmap Phase 9 "native install"): Chromium browsers hand the app a deferred
 * `beforeinstallprompt`; iOS Safari has no prompt, only "Add to Home Screen" in the share sheet.
 * One page-wide capture, exposed with `useSyncExternalStore`.
 */
import { useCallback, useSyncExternalStore } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export type InstallState =
  /** Nothing to offer: unsupported, or the browser has not offered a prompt (yet). */
  | 'none'
  /** A deferred prompt is waiting; `install()` shows it. */
  | 'promptable'
  /** iOS Safari: only manual "Add to Home Screen". */
  | 'manual-ios'
  | 'installed';

const listeners = new Set<() => void>();
let deferred: BeforeInstallPromptEvent | null = null;
let installed = false;
let hooked = false;

function notify(): void {
  for (const l of listeners) l();
}

function hook(): void {
  if (hooked || typeof window === 'undefined') return;
  hooked = true;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    installed = true;
    deferred = null;
    notify();
  });
}

export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const nav = navigator as Navigator & { standalone?: boolean };
  return (
    (typeof window.matchMedia === 'function' &&
      window.matchMedia('(display-mode: standalone)').matches) ||
    nav.standalone === true
  );
}

function isIosSafari(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (ua.includes('Mac') && navigator.maxTouchPoints > 1);
  return ios && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
}

function getState(): InstallState {
  if (installed || isStandalone()) return 'installed';
  if (deferred) return 'promptable';
  if (isIosSafari()) return 'manual-ios';
  return 'none';
}

const getServerState = (): InstallState => 'none';

// Chromium fires `beforeinstallprompt` once, shortly after load: the listener must exist before
// any component asks, so it is attached when this client module is evaluated.
hook();

function subscribe(listener: () => void): () => void {
  hook();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useInstallPrompt(): {
  state: InstallState;
  /** Shows the browser's install prompt; resolves to whether the user accepted. */
  install: () => Promise<boolean>;
} {
  const state = useSyncExternalStore(subscribe, getState, getServerState);
  const install = useCallback(async () => {
    const e = deferred;
    if (!e) return false;
    deferred = null;
    notify();
    await e.prompt();
    const choice = await e.userChoice;
    if (choice.outcome === 'accepted') {
      installed = true;
      notify();
      return true;
    }
    return false;
  }, []);
  return { state, install };
}
