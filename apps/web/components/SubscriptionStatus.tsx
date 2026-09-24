'use client';
import { useAccount, usePortal } from '@/features/account/use-account';
import { Badge, Button } from '@lightmap/ui';

export function SubscriptionStatus() {
  const account = useAccount();
  const portal = usePortal();
  const snap = account.snapshot;
  if (!snap) return null;
  const sub = account.subscription;
  return (
    <div className="space-y-2 text-sm" data-testid="subscription-status">
      <div className="flex items-center gap-2">
        <span className="text-[var(--lm-text-muted)]">Plan</span>
        <Badge tone={snap.effectivePlan === 'free' ? 'neutral' : 'sun'}>{snap.planName}{snap.grace ? ' · payment issue' : ''}</Badge>
      </div>
      {snap.accessEndsAt ? <p className="text-xs text-[var(--lm-text-muted)]">{sub?.cancelAtPeriodEnd ? 'Cancels' : 'Renews'} {new Date(snap.accessEndsAt).toLocaleDateString()}</p> : null}
      {snap.grace ? <p className="text-xs text-[color:#ffd27a]">Your last payment failed. Access continues for a few days while Stripe retries — update your card in the portal.</p> : null}
      {sub?.hasCustomer ? <Button size="sm" onClick={() => portal.mutate()} disabled={portal.isPending}>Manage billing</Button> : null}
    </div>
  );
}
