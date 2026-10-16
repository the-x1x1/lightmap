'use client';
import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Button } from '@lightmap/ui';
import { ApiRequestError, api } from '@/lib/client/api';
import { useAccount } from '@/features/account/use-account';
import { SignInPrompt } from './AccountMenu';

interface LinkInfo {
  code: string;
  deviceName: string;
  state: 'waiting' | 'approved' | 'expired';
  /** Whether this browser is on the network the app asked from. */
  sameNetwork?: boolean;
  /** How long ago the app asked, seconds. */
  ageSeconds?: number;
}

function ago(seconds: number | undefined): string {
  if (seconds === undefined) return '';
  if (seconds < 60) return 'just now';
  const m = Math.round(seconds / 60);
  return `${m} minute${m === 1 ? '' : 's'} ago`;
}

/**
 * The website's half of a desktop app's sign-in: the person signs in here if they need to, sees
 * the app's name and code, and approves it; the app notices within seconds. The code on this
 * page must match the one the app shows, which is what stops someone else's link from being
 * approved by mistake.
 */
export function LinkDevice({ code }: { code: string }) {
  const account = useAccount();
  const [done, setDone] = useState(false);
  const [typed, setTyped] = useState('');
  const info = useQuery({
    queryKey: ['device-link', code],
    queryFn: () => api.get<LinkInfo>(`/api/desktop/link?code=${encodeURIComponent(code)}`),
    enabled: account.signedIn && code.length > 0,
    retry: false,
  });
  const approve = useMutation({
    mutationFn: () =>
      api.post<{ approved: boolean }>('/api/desktop/link/approve', { code, typedCode: typed }),
    onSuccess: () => setDone(true),
  });

  if (account.isLoading)
    return (
      <p className="text-sm text-[var(--lm-text-muted)]" role="status">
        Loading…
      </p>
    );
  if (!code)
    return (
      <p className="text-sm">
        This page is opened by the LightMap app. Choose Sign in with your browser in the app to
        start.
      </p>
    );
  if (!account.signedIn)
    return (
      <SignInPrompt reason="Sign in to your LightMap account, then approve the app on this page." />
    );
  if (done)
    return (
      <p className="text-sm" role="status" data-testid="link-approved">
        Done. The LightMap app on {info.data?.deviceName ?? 'your computer'} is signed in as{' '}
        {account.user?.email}; you can close this page.
      </p>
    );
  if (info.isLoading)
    return (
      <p className="text-sm text-[var(--lm-text-muted)]" role="status">
        Looking up the code…
      </p>
    );
  if (info.isError || !info.data)
    return (
      <p className="text-sm text-[color:#ffb3b3]" role="alert">
        {info.error instanceof ApiRequestError
          ? info.error.message
          : 'That code could not be found. Start the sign-in again in the app.'}
      </p>
    );
  if (info.data.state !== 'waiting')
    return (
      <p className="text-sm" role="status">
        {info.data.state === 'approved'
          ? 'This code was already approved.'
          : 'This code has expired. Start the sign-in again in the app.'}
      </p>
    );
  // A sign-in started on another network is approved only by typing the code from the app: a
  // link someone sent you cannot be (device-code phishing). On the same network (the app opened
  // this browser) the code is shown to compare instead.
  const mustType = info.data.sameNetwork !== true;
  const norm = (v: string) => v.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const typedOk = norm(typed) === norm(info.data.code);
  return (
    <div className="space-y-4" data-testid="link-device">
      <p className="text-sm">
        A LightMap app on a computer named <strong>{info.data.deviceName}</strong> asked{' '}
        {ago(info.data.ageSeconds)} to sign in as <strong>{account.user?.email}</strong>. It will
        see and change your projects and use your plan.
      </p>
      {mustType ? (
        <div
          className="rounded-lg border border-[color:#ffb3b3]/40 p-3 text-sm"
          role="alert"
          data-testid="link-other-network"
        >
          <p>
            This sign-in was started from a different network than this browser. If someone sent you
            this link or asked you for a code, <strong>stop</strong>: approving it would give them
            your account.
          </p>
          <label className="mt-3 block">
            If it is your own computer, type the code its LightMap app shows:
            <input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              className="mt-1 block w-40 rounded-md border border-white/15 bg-transparent px-2 py-1 font-mono text-lg tracking-wider"
              autoComplete="off"
              spellCheck={false}
              maxLength={9}
              data-testid="link-typed"
            />
          </label>
        </div>
      ) : (
        <p className="text-sm">
          Approve only if you just chose Sign in with your browser in the app and it shows this
          code:{' '}
          <span className="font-mono text-lg font-semibold tracking-wider" data-testid="link-code">
            {info.data.code}
          </span>
        </p>
      )}
      {approve.isError ? (
        <p className="text-sm text-[color:#ffb3b3]" role="alert">
          {approve.error instanceof ApiRequestError
            ? approve.error.message
            : 'That did not work. Try again.'}
        </p>
      ) : null}
      <Button
        variant="primary"
        onClick={() => approve.mutate()}
        disabled={approve.isPending || (mustType && !typedOk)}
        data-testid="link-approve"
      >
        {approve.isPending ? 'Approving…' : 'Approve and sign in the app'}
      </Button>
    </div>
  );
}
