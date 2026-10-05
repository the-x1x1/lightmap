'use client';
/**
 * The landing after Stripe Checkout (plan §38, step 7: "the existing plan immediately unlocks").
 * Stripe confirms through the webhook a few seconds after the redirect, so the page re-reads the
 * entitlement snapshot every couple of seconds until the effective plan is no longer Free, then
 * says so and offers the map. If nothing arrives in a minute it says what to do, without
 * pretending.
 */
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAccount } from '@/features/account/use-account';

const POLL_MS = 2_000;
const GIVE_UP_MS = 60_000;

export function CheckoutReturn({ outcome }: { outcome: 'success' | 'cancelled' }) {
  const account = useAccount();
  const qc = useQueryClient();
  const [waitedMs, setWaitedMs] = useState(0);
  const unlocked =
    outcome === 'success' && account.snapshot !== null && account.snapshot.effectivePlan !== 'free';
  // The account could not be read at all (fetch error, or no session after the redirect): a
  // different message from "Stripe has not confirmed".
  const unreadable = !account.isLoading && (account.isError || !account.signedIn);
  const waiting = outcome === 'success' && !unlocked && !unreadable && waitedMs < GIVE_UP_MS;

  useEffect(() => {
    if (!waiting) return;
    const id = setInterval(() => {
      void qc.invalidateQueries({ queryKey: ['account'] });
      setWaitedMs((ms) => ms + POLL_MS);
    }, POLL_MS);
    return () => clearInterval(id);
  }, [waiting, qc]);

  if (outcome === 'cancelled')
    return (
      <p className="mt-2 text-sm text-[var(--lm-text-muted)]" data-testid="checkout-cancelled">
        Checkout cancelled. Nothing was charged.
      </p>
    );
  if (unlocked)
    return (
      <p
        className="mt-2 rounded-[var(--lm-radius-sm)] bg-[color:rgba(88,196,138,0.15)] p-3 text-sm"
        role="status"
        data-testid="checkout-unlocked"
      >
        You&rsquo;re on {account.snapshot?.planName ?? 'Pro'} — everything is unlocked, including
        the plan you were working on.{' '}
        <Link href="/" className="underline">
          Back to the map
        </Link>
        .
      </p>
    );
  if (unreadable)
    return (
      <p
        className="mt-2 rounded-[var(--lm-radius-sm)] bg-[color:rgba(255,210,122,0.15)] p-3 text-sm"
        role="status"
        data-testid="checkout-unreadable"
      >
        {account.isError
          ? 'Your account could not be read just now. Reload this page in a moment; the subscription itself is confirmed by Stripe independently of this page.'
          : 'You are not signed in on this device, so your plan cannot be shown here. Sign in with the same account you subscribed with and it will be unlocked.'}
      </p>
    );
  if (waiting)
    return (
      <p
        className="mt-2 rounded-[var(--lm-radius-sm)] bg-[color:rgba(88,196,138,0.15)] p-3 text-sm"
        role="status"
        aria-busy
        data-testid="checkout-pending"
      >
        Thanks — your subscription is being activated. Stripe usually confirms within a few seconds;
        this page updates by itself.
      </p>
    );
  return (
    <p
      className="mt-2 rounded-[var(--lm-radius-sm)] bg-[color:rgba(255,210,122,0.15)] p-3 text-sm"
      role="status"
      data-testid="checkout-unconfirmed"
    >
      Stripe has not confirmed the subscription yet. Nothing more is needed from you: reload this
      page in a minute, and if your plan still shows Free after that, use the receipt email from
      Stripe to get in touch.
    </p>
  );
}
