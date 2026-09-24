'use client';
/** Pro value explained plainly (plan §38). Never crippling: the map and today's light stay free. */
import { PLANS } from '@lightmap/entitlements';
import { brand } from '@lightmap/config';
import { useAccount, useCheckout } from '@/features/account/use-account';
import { useCapabilities } from '@/features/planner/use-scene';
import { Button, cx } from '@lightmap/ui';
import { SignInPrompt } from './AccountMenu';

export function Paywall({ reason, compact }: { reason?: string; compact?: boolean }) {
  const account = useAccount();
  const caps = useCapabilities();
  const checkout = useCheckout();
  const pro = PLANS.pro;
  if (!account.signedIn) return <SignInPrompt reason={reason ?? `${brand.billing.proName} needs an account.`} />;
  const configured = caps.data?.billingConfigured ?? false;
  return (
    <div className={cx('rounded-[var(--lm-radius)] border border-[var(--lm-sun)]/30 bg-[color:rgba(245,179,66,0.08)] p-4', compact && 'p-3')} data-testid="paywall">
      {reason ? <p className="text-sm text-[color:#ffd27a]">{reason}</p> : null}
      <h3 className="mt-1 text-base font-semibold">{brand.billing.proName}</h3>
      <p className="text-sm text-[var(--lm-text-muted)]">{brand.billing.proDescription}</p>
      {!compact ? (
        <ul className="mt-2 space-y-1 text-sm">
          {pro.highlights.map((h) => (
            <li key={h} className="flex gap-2"><span aria-hidden className="text-[var(--lm-sun)]">✓</span>{h}</li>
          ))}
        </ul>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="primary" onClick={() => checkout.mutate('monthly')} disabled={!configured || checkout.isPending} data-testid="checkout-monthly">Monthly</Button>
        <Button variant="secondary" onClick={() => checkout.mutate('yearly')} disabled={!configured || checkout.isPending} data-testid="checkout-yearly">Yearly</Button>
      </div>
      {!configured ? <p className="mt-2 text-xs text-[var(--lm-text-faint)]">Billing is not set up on this server yet (Stripe keys missing).</p> : null}
      {checkout.isError ? <p className="mt-2 text-xs text-[color:#ffb3b3]" role="alert">{String((checkout.error as Error).message)}</p> : null}
    </div>
  );
}
