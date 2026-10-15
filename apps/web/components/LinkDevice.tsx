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
  const info = useQuery({
    queryKey: ['device-link', code],
    queryFn: () => api.get<LinkInfo>(`/api/desktop/link?code=${encodeURIComponent(code)}`),
    enabled: account.signedIn && code.length > 0,
    retry: false,
  });
  const approve = useMutation({
    mutationFn: () => api.post<{ approved: boolean }>('/api/desktop/link/approve', { code }),
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
  return (
    <div className="space-y-4" data-testid="link-device">
      <p className="text-sm">
        A LightMap app on a computer named <strong>{info.data.deviceName}</strong> wants to sign in
        as <strong>{account.user?.email}</strong>. It will see and change your projects and use your
        plan. If you did not just choose Sign in with your browser in the app, do not approve it.
      </p>
      <p className="text-sm">
        Approve only if the app shows this code:{' '}
        <span className="font-mono text-lg font-semibold tracking-wider" data-testid="link-code">
          {info.data.code}
        </span>
      </p>
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
        disabled={approve.isPending}
        data-testid="link-approve"
      >
        {approve.isPending ? 'Approving…' : 'Approve and sign in the app'}
      </Button>
    </div>
  );
}
