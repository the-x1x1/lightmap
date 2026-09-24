'use client';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { useState } from 'react';
import { signIn, signOut } from 'next-auth/react';
import { useAccount, useDeleteAccount } from '@/features/account/use-account';
import { useCapabilities } from '@/features/planner/use-scene';
import { usePlannerStore } from '@/features/planner/store';
import { Button, cx } from '@lightmap/ui';
import { SubscriptionStatus } from './SubscriptionStatus';
import { Paywall } from './Paywall';

export function AccountMenu() {
  const account = useAccount();
  const setPanel = usePlannerStore((s) => s.setPanel);
  const initial = account.user?.email?.[0]?.toUpperCase() ?? '?';
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button type="button" className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-sm font-semibold ring-1 ring-inset ring-white/10 hover:bg-white/15 focus-visible:outline-none focus-visible:[box-shadow:var(--lm-focus)]" aria-label="Account" data-testid="account-button">
          {account.signedIn ? initial : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 4-6 8-6s8 2 8 6" /></svg>}
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={8} className="z-50 min-w-56 rounded-[var(--lm-radius)] border border-[var(--lm-panel-border)] bg-[var(--lm-panel-raised)] p-1.5 text-sm shadow-[var(--lm-shadow)]">
          {account.signedIn ? (
            <>
              <div className="px-2 py-1.5 text-xs text-[var(--lm-text-muted)]">{account.user?.email}</div>
              <Item onSelect={() => setPanel('account')}>Account &amp; plan</Item>
              <Item onSelect={() => setPanel('projects')}>Projects</Item>
              <DropdownMenu.Separator className="my-1 h-px bg-white/10" />
              <Item onSelect={() => void signOut({ callbackUrl: '/' })}>Sign out</Item>
            </>
          ) : (
            <>
              <Item onSelect={() => setPanel('account')}>Sign in</Item>
              <Item onSelect={() => setPanel('account')}>About Pro</Item>
            </>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function Item({ children, onSelect }: { children: React.ReactNode; onSelect: () => void }) {
  return (
    <DropdownMenu.Item onSelect={onSelect} className="cursor-pointer rounded-[6px] px-2 py-2 outline-none data-[highlighted]:bg-white/10">
      {children}
    </DropdownMenu.Item>
  );
}

export function SignInPrompt({ reason }: { reason?: string }) {
  const caps = useCapabilities();
  const methods = caps.data?.authMethods;
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  if (!methods || (!methods.email && !methods.google && !methods.devLogin)) {
    return <p className="text-sm text-[var(--lm-text-muted)]">Accounts are not available on this server (no database configured). Exploring the map still works.</p>;
  }
  return (
    <div className="space-y-3" data-testid="sign-in">
      {reason ? <p className="text-sm text-[var(--lm-text-muted)]">{reason}</p> : null}
      {sent ? <p className="text-sm" role="status">Check your email for a sign-in link. It expires in 15 minutes.</p> : null}
      {methods.email && !sent ? (
        <form
          className="flex flex-col gap-2 sm:flex-row"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy('email');
            try {
              await signIn('nodemailer', { email, redirect: false });
              setSent(true);
            } finally {
              setBusy(null);
            }
          }}
        >
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" aria-label="Email address" className="h-11 flex-1 rounded-[var(--lm-radius-sm)] border border-[var(--lm-panel-border)] bg-[var(--lm-panel-raised)] px-3 text-sm focus:outline-none focus-visible:[box-shadow:var(--lm-focus)]" data-testid="sign-in-email" />
          <Button type="submit" variant="primary" disabled={busy !== null}>Email me a link</Button>
        </form>
      ) : null}
      {methods.google ? <Button onClick={() => void signIn('google')} className="w-full">Continue with Google</Button> : null}
      {methods.devLogin ? (
        <form
          className={cx('flex gap-2 rounded-[var(--lm-radius-sm)] border border-dashed border-[color:rgba(245,179,66,0.5)] p-2')}
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy('dev');
            await signIn('dev-login', { email, callbackUrl: window.location.pathname });
          }}
        >
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="dev@example.com" aria-label="Dev sign-in email" className="h-10 flex-1 rounded bg-[var(--lm-panel-raised)] px-2 text-sm" data-testid="dev-login-email" />
          <Button type="submit" size="sm" variant="secondary" disabled={busy !== null} data-testid="dev-login-submit">Dev sign-in</Button>
        </form>
      ) : null}
    </div>
  );
}

export function AccountPanel() {
  const account = useAccount();
  const del = useDeleteAccount();
  if (!account.signedIn) return <SignInPrompt reason="Sign in to save projects, sync across devices and subscribe." />;
  return (
    <div className="space-y-4" data-testid="account-panel">
      <SubscriptionStatus />
      {account.snapshot?.effectivePlan === 'free' ? <Paywall /> : null}
      <details>
        <summary className="cursor-pointer text-xs uppercase tracking-wide text-[var(--lm-text-muted)]">Delete account</summary>
        <p className="mt-2 text-sm text-[var(--lm-text-muted)]">Requests deletion of your account, projects and viewpoints. Data is erased after 14 days; signing in again before then cancels the request.</p>
        <Button variant="danger" size="sm" className="mt-2" onClick={() => { if (confirm('Request account deletion?')) del.mutate(); }} disabled={del.isPending}>Request deletion</Button>
        {del.isSuccess ? <p className="mt-2 text-sm" role="status">Deletion requested. Your data will be erased in 14 days.</p> : null}
      </details>
    </div>
  );
}
