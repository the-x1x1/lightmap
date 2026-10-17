'use client';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { useEffect, useRef, useState } from 'react';
import { signIn, signOut } from 'next-auth/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiRequestError, api } from '@/lib/client/api';
import { useAccount, useDeleteAccount } from '@/features/account/use-account';
import { clearLocalPreferences } from '@/features/account/use-preferences';
import { useCapabilities } from '@/features/planner/use-scene';
import { usePlannerStore } from '@/features/planner/store';
import { useInstallPrompt, type InstallState } from '@/features/pwa/use-install-prompt';
import { Button, cx } from '@lightmap/ui';
import { SubscriptionStatus } from './SubscriptionStatus';
import { Paywall } from './Paywall';
import { Preferences } from './Preferences';

export function AccountMenu() {
  const account = useAccount();
  const caps = useCapabilities();
  const queryClient = useQueryClient();
  const setPanel = usePlannerStore((s) => s.setPanel);
  const initial = account.user?.email?.[0]?.toUpperCase() ?? '?';
  // Subscribed here, in the always-mounted menu button: the dropdown's content only exists while open.
  const install = useInstallPrompt();
  // When an item opens a panel, keep focus moving into that panel (MapShell focuses the panel
  // body on change) instead of Radix returning it to the trigger.
  const movedFocus = useRef(false);
  const openPanel = (p: 'account' | 'projects') => {
    // The shell only moves focus when the panel actually changes; otherwise let Radix return it.
    movedFocus.current = usePlannerStore.getState().panel !== p;
    setPanel(p);
  };
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-sm font-semibold ring-1 ring-inset ring-white/10 hover:bg-white/15 focus-visible:outline-none focus-visible:[box-shadow:var(--lm-focus)]"
          aria-label="Account"
          data-testid="account-button"
          data-signed-in={account.signedIn ? 'true' : 'false'}
        >
          {account.signedIn ? (
            initial
          ) : (
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden
            >
              <circle cx="12" cy="8" r="4" />
              <path d="M4 21c0-4 4-6 8-6s8 2 8 6" />
            </svg>
          )}
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={8}
          onCloseAutoFocus={(e) => {
            if (movedFocus.current) {
              e.preventDefault();
              movedFocus.current = false;
            }
          }}
          className="z-50 min-w-56 rounded-[var(--lm-radius)] border border-[var(--lm-panel-border)] bg-[var(--lm-panel-raised)] p-1.5 text-sm shadow-[var(--lm-shadow)]"
        >
          {account.signedIn ? (
            <>
              <DropdownMenu.Label className="px-2 py-1.5 text-xs text-[var(--lm-text-muted)]">
                {account.user?.email}
              </DropdownMenu.Label>
              <Item onSelect={() => openPanel('account')}>Account &amp; plan</Item>
              <Item onSelect={() => openPanel('projects')}>Projects</Item>
              <DropdownMenu.Separator className="my-1 h-px bg-white/10" />
              <Item
                onSelect={() => {
                  clearLocalPreferences();
                  if (caps.data?.desktopAccounts)
                    // A desktop app signs out its device token; the page itself has no session.
                    void api
                      .delete('/api/desktop/signin')
                      .finally(() => void queryClient.invalidateQueries());
                  else void signOut({ callbackUrl: '/' });
                }}
              >
                Sign out
              </Item>
            </>
          ) : (
            <>
              <Item onSelect={() => openPanel('account')}>Sign in</Item>
              <Item onSelect={() => openPanel('account')}>About Pro</Item>
            </>
          )}
          <InstallItem state={install.state} install={install.install} />
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/** "Install app" when the browser offers a prompt; the iOS hint when it does not. */
function InstallItem({ state, install }: { state: InstallState; install: () => Promise<boolean> }) {
  if (state === 'none' || state === 'installed') return null;
  return (
    <>
      <DropdownMenu.Separator className="my-1 h-px bg-white/10" />
      {state === 'promptable' ? (
        <Item onSelect={() => void install()}>Install app</Item>
      ) : (
        <DropdownMenu.Label className="px-2 py-1.5 text-xs text-[var(--lm-text-muted)]">
          Install: Share → Add to Home Screen
        </DropdownMenu.Label>
      )}
    </>
  );
}

function Item({ children, onSelect }: { children: React.ReactNode; onSelect: () => void }) {
  return (
    <DropdownMenu.Item
      onSelect={onSelect}
      className="cursor-pointer rounded-[6px] px-2 py-2 outline-none data-[highlighted]:bg-white/10"
    >
      {children}
    </DropdownMenu.Item>
  );
}

interface DesktopSignInStatus {
  signedIn: boolean;
  expired?: boolean;
  waiting?: { code: string; verifyUrl: string };
}

/**
 * A desktop app signs in through the browser: the hosted LightMap's page opens with a code, the
 * person checks the code matches and approves it there (signing in first if they need to), and
 * this panel notices within a few seconds.
 */
function DesktopSignIn({ reason }: { reason?: string | undefined }) {
  const queryClient = useQueryClient();
  const [waiting, setWaiting] = useState<{ code: string; verifyUrl: string } | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const status = useQuery({
    queryKey: ['desktop-signin', waiting?.code],
    queryFn: () => api.get<DesktopSignInStatus>('/api/desktop/signin'),
    enabled: waiting !== null,
    refetchInterval: 3000,
  });
  useEffect(() => {
    const d = status.data;
    if (!d) return;
    if (d.signedIn) {
      setWaiting(null);
      void queryClient.invalidateQueries();
    } else if (d.expired) {
      setWaiting(null);
      setFailure('That sign-in expired before it was approved. Start it again.');
    }
  }, [status.data, queryClient]);
  const start = async () => {
    setBusy(true);
    setFailure(null);
    try {
      const link = await api.post<{ code: string; verifyUrl: string }>('/api/desktop/signin', {});
      setWaiting(link);
      window.open(link.verifyUrl, '_blank', 'noopener');
    } catch (e) {
      setFailure(
        e instanceof ApiRequestError ? e.message : 'The sign-in could not start. Try again.',
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-3" data-testid="sign-in">
      {reason ? <p className="text-sm text-[var(--lm-text-muted)]">{reason}</p> : null}
      {failure ? (
        <p className="text-sm text-[color:#ffb3b3]" role="alert">
          {failure}
        </p>
      ) : null}
      {waiting ? (
        <div className="space-y-2" role="status" data-testid="desktop-signin-waiting">
          <p className="text-sm">
            Finish in your browser: check that the page shows{' '}
            <span className="font-mono font-semibold tracking-wider">{waiting.code}</span>, then
            approve it. This panel updates by itself.
          </p>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => window.open(waiting.verifyUrl, '_blank', 'noopener')}
            >
              Open the page again
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setWaiting(null)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button
          variant="primary"
          className="w-full"
          disabled={busy}
          onClick={() => void start()}
          data-testid="desktop-signin"
        >
          {busy ? 'Starting…' : 'Sign in with your browser'}
        </Button>
      )}
    </div>
  );
}

export function SignInPrompt({ reason }: { reason?: string }) {
  const caps = useCapabilities();
  const methods = caps.data?.authMethods;
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  if (caps.isLoading && !methods)
    return (
      <p className="text-sm text-[var(--lm-text-muted)]" role="status">
        Checking sign-in options…
      </p>
    );
  if (caps.data?.desktopAccounts) return <DesktopSignIn reason={reason} />;
  if (!methods || (!methods.email && !methods.google && !methods.devLogin)) {
    return (
      <p className="text-sm text-[var(--lm-text-muted)]" data-testid="accounts-unavailable">
        {caps.data?.desktopApp
          ? // A desktop app with no hosted service to sign in to yet: not a server fault.
            'Signing in and saved projects come to the app once the LightMap service opens. Planning works fully here meanwhile.'
          : 'Accounts are not available on this server (no database configured). Exploring the map still works.'}
      </p>
    );
  }
  return (
    <div className="space-y-3" data-testid="sign-in">
      {reason ? <p className="text-sm text-[var(--lm-text-muted)]">{reason}</p> : null}
      <p className="text-sm" role="status">
        {sent ? 'Check your email for a sign-in link. It expires in 15 minutes.' : ''}
        {busy === 'email' ? 'Sending your sign-in link…' : ''}
      </p>
      {failure ? (
        <p className="text-sm text-[color:#ffb3b3]" role="alert">
          {failure}
        </p>
      ) : null}
      {methods.email && !sent ? (
        <form
          className="flex flex-col gap-2 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            setBusy('email');
            setFailure(null);
            void (async () => {
              try {
                // With redirect:false Auth.js resolves with { error } instead of throwing.
                const r = await signIn('nodemailer', { email, redirect: false });
                if (r.error)
                  setFailure('We could not send the link. Check the address and try again.');
                else setSent(true);
              } catch {
                setFailure('We could not reach the sign-in service. Try again in a moment.');
              } finally {
                setBusy(null);
              }
            })();
          }}
        >
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            aria-label="Email address"
            className="h-11 flex-1 rounded-[var(--lm-radius-sm)] border border-[var(--lm-panel-border)] bg-[var(--lm-panel-raised)] px-3 text-sm focus:outline-none focus-visible:[box-shadow:var(--lm-focus)]"
            data-testid="sign-in-email"
          />
          <Button type="submit" variant="primary" disabled={busy !== null}>
            {busy === 'email' ? 'Sending…' : 'Email me a link'}
          </Button>
        </form>
      ) : null}
      {methods.google ? (
        <Button onClick={() => void signIn('google')} className="w-full">
          Continue with Google
        </Button>
      ) : null}
      {methods.devLogin ? (
        <form
          className={cx(
            'flex gap-2 rounded-[var(--lm-radius-sm)] border border-dashed border-[color:rgba(245,179,66,0.5)] p-2',
          )}
          onSubmit={(e) => {
            e.preventDefault();
            setBusy('dev');
            void signIn('dev-login', {
              email,
              callbackUrl: window.location.pathname + window.location.search,
            });
          }}
        >
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="dev@example.com"
            aria-label="Dev sign-in email"
            className="h-10 flex-1 rounded bg-[var(--lm-panel-raised)] px-2 text-sm"
            data-testid="dev-login-email"
          />
          <Button
            type="submit"
            size="sm"
            variant="secondary"
            disabled={busy !== null}
            data-testid="dev-login-submit"
          >
            Dev sign-in
          </Button>
        </form>
      ) : null}
    </div>
  );
}

export function AccountPanel() {
  const account = useAccount();
  const del = useDeleteAccount();
  if (!account.signedIn)
    return (
      <div className="space-y-5">
        <SignInPrompt reason="Sign in to save projects, sync across devices and subscribe." />
        <Preferences />
      </div>
    );
  return (
    <div className="space-y-4" data-testid="account-panel">
      <SubscriptionStatus />
      {account.snapshot?.effectivePlan === 'free' ? <Paywall /> : null}
      <Preferences />
      <details>
        <summary className="cursor-pointer text-xs uppercase tracking-wide text-[var(--lm-text-muted)]">
          Delete account
        </summary>
        <p className="mt-2 text-sm text-[var(--lm-text-muted)]">
          Requests deletion of your account, projects and viewpoints. Data is erased after 14 days;
          signing in again before then cancels the request.
        </p>
        <Button
          variant="danger"
          size="sm"
          className="mt-2"
          onClick={() => {
            if (confirm('Request account deletion?')) del.mutate();
          }}
          disabled={del.isPending}
        >
          Request deletion
        </Button>
        {del.isSuccess ? (
          <p className="mt-2 text-sm" role="status">
            Deletion requested. Your data will be erased in 14 days.
          </p>
        ) : null}
        {del.isError ? (
          <p className="mt-2 text-sm text-[color:#ffb3b3]" role="alert">
            The request did not go through. Nothing was changed; try again or contact support.
          </p>
        ) : null}
      </details>
    </div>
  );
}
