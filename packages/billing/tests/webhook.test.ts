import { describe, expect, it } from 'vitest';
import { deriveEntitlements } from '@lightmap/entitlements';
import {
  HANDLED_EVENT_TYPES,
  normalizeStatus,
  priceMapFromEnv,
  processWebhookEvent,
  subscriptionToRecord,
  type BillingStore,
  type StripeEventLike,
  type StripeSubscriptionLike,
  type SubscriptionUpsert,
} from '../src/webhook.ts';

function memoryStore(customers: Record<string, string> = {}) {
  const events = new Map<string, string>();
  const subs: SubscriptionUpsert[] = [];
  const audits: Array<{ action: string; userId: string | null }> = [];
  const store: BillingStore & {
    events: typeof events;
    subs: typeof subs;
    audits: typeof audits;
    customers: Record<string, string>;
  } = {
    events,
    subs,
    audits,
    customers,
    async recordEvent(e) {
      if (events.has(e.providerEventId)) return false;
      events.set(e.providerEventId, e.outcome);
      return true;
    },
    async wasProcessed(id) {
      return events.has(id);
    },
    async userIdForCustomer(c) {
      return customers[c] ?? null;
    },
    async upsertSubscription(s) {
      subs.push(s);
    },
    async audit(action, userId) {
      audits.push({ action, userId });
    },
  };
  return store;
}

const priceMap = { pro: ['price_pro_month', 'price_pro_year'] };
const sub = (over: Partial<StripeSubscriptionLike> = {}): StripeSubscriptionLike => ({
  id: 'sub_1',
  customer: 'cus_1',
  status: 'active',
  cancel_at_period_end: false,
  items: {
    data: [
      {
        price: { id: 'price_pro_month' },
        current_period_start: 1_780_000_000,
        current_period_end: 1_782_600_000,
      },
    ],
  },
  ...over,
});
const ev = (id: string, type: string, object: unknown): StripeEventLike => ({
  id,
  type,
  created: 1_780_000_000,
  data: { object },
});

function deps(
  store: ReturnType<typeof memoryStore>,
  fetched: StripeSubscriptionLike | null = sub(),
) {
  return {
    store,
    priceMap,
    fetchSubscription: async () => fetched,
    linkCustomer: async (u: string, c: string) => {
      store.customers[c] = u;
    },
  };
}

describe('webhook processing', () => {
  it('subscription.created for a known customer writes a Pro record and derives Pro entitlements', async () => {
    const store = memoryStore({ cus_1: 'user_1' });
    const out = await processWebhookEvent(
      ev('evt_1', 'customer.subscription.created', sub()),
      deps(store),
    );
    expect(out).toMatchObject({ outcome: 'processed', userId: 'user_1' });
    expect(store.subs[0]).toMatchObject({
      userId: 'user_1',
      planKey: 'pro',
      status: 'active',
      priceId: 'price_pro_month',
    });
    expect(store.subs[0]!.periodEnd?.toISOString()).toBe(
      new Date(1_782_600_000 * 1000).toISOString(),
    );
    const snap = deriveEntitlements(
      {
        planKey: store.subs[0]!.planKey,
        status: store.subs[0]!.status,
        periodEnd: store.subs[0]!.periodEnd!.toISOString(),
        cancelAtPeriodEnd: false,
      },
      new Date(1_781_000_000 * 1000),
    );
    expect(snap.effectivePlan).toBe('pro');
  });

  it('is idempotent: replaying the same event id does nothing', async () => {
    const store = memoryStore({ cus_1: 'user_1' });
    await processWebhookEvent(ev('evt_1', 'customer.subscription.updated', sub()), deps(store));
    const replay = await processWebhookEvent(
      ev('evt_1', 'customer.subscription.updated', sub({ status: 'canceled' })),
      deps(store),
    );
    expect(replay.outcome).toBe('duplicate');
    expect(store.subs).toHaveLength(1);
    expect(store.subs[0]!.status).toBe('active');
  });

  it('checkout.session.completed links the customer to the user and applies the subscription', async () => {
    const store = memoryStore();
    const out = await processWebhookEvent(
      ev('evt_c', 'checkout.session.completed', {
        id: 'cs_1',
        customer: 'cus_9',
        subscription: 'sub_1',
        client_reference_id: 'user_9',
      }),
      deps(store, sub({ customer: 'cus_9' })),
    );
    expect(out.outcome).toBe('processed');
    expect(store.customers['cus_9']).toBe('user_9');
    expect(store.subs[0]).toMatchObject({ userId: 'user_9', planKey: 'pro' });
  });

  it('cancellation and payment failure downgrade correctly', async () => {
    const store = memoryStore({ cus_1: 'user_1' });
    await processWebhookEvent(
      ev('evt_d', 'customer.subscription.deleted', sub({ status: 'active' })),
      deps(store),
    );
    expect(store.subs.at(-1)!.status).toBe('canceled');
    const pastDue = sub({ status: 'past_due' });
    await processWebhookEvent(
      ev('evt_f', 'invoice.payment_failed', {
        id: 'in_1',
        customer: 'cus_1',
        subscription: 'sub_1',
      }),
      deps(store, pastDue),
    );
    expect(store.subs.at(-1)!.status).toBe('past_due');
    // Newer API shape: subscription nested under parent.
    await processWebhookEvent(
      ev('evt_g', 'invoice.payment_succeeded', {
        id: 'in_2',
        customer: 'cus_1',
        parent: { subscription_details: { subscription: 'sub_1' } },
      }),
      deps(store, sub({ status: 'active' })),
    );
    expect(store.subs.at(-1)!.status).toBe('active');
  });

  it('never grants Pro for an unknown price, and files unmapped customers for review', async () => {
    const store = memoryStore({ cus_1: 'user_1' });
    await processWebhookEvent(
      ev(
        'evt_u',
        'customer.subscription.created',
        sub({ items: { data: [{ price: { id: 'price_unknown' } }] } }),
      ),
      deps(store),
    );
    expect(store.subs[0]!.planKey).toBe('free');
    const unmapped = await processWebhookEvent(
      ev('evt_x', 'customer.subscription.created', sub({ customer: 'cus_nobody' })),
      deps(store),
    );
    expect(unmapped.outcome).toBe('unmapped');
    expect(store.audits.some((a) => a.action === 'billing.unmapped_event')).toBe(true);
    expect(store.subs).toHaveLength(1);
  });

  it('ignores unhandled types, records refunds for audit, and upgrades plans on price change', async () => {
    const store = memoryStore({ cus_1: 'user_1' });
    expect(
      (await processWebhookEvent(ev('evt_i', 'payment_intent.created', {}), deps(store))).outcome,
    ).toBe('ignored');
    expect(
      (
        await processWebhookEvent(
          ev('evt_r', 'charge.refunded', { id: 'ch_1', customer: 'cus_1' }),
          deps(store),
        )
      ).outcome,
    ).toBe('processed');
    expect(
      store.audits.some((a) => a.action === 'billing.charge_refunded' && a.userId === 'user_1'),
    ).toBe(true);
    expect(store.subs).toHaveLength(0);
    await processWebhookEvent(
      ev(
        'evt_up',
        'customer.subscription.updated',
        sub({ items: { data: [{ price: { id: 'price_pro_year' } }] } }),
      ),
      deps(store),
    );
    expect(store.subs[0]!.priceId).toBe('price_pro_year');
    expect(HANDLED_EVENT_TYPES).toContain('customer.subscription.trial_will_end');
  });

  it('helpers: status normalisation, price map from env, period from top-level fields', () => {
    expect(normalizeStatus('active')).toBe('active');
    expect(normalizeStatus('weird')).toBe('incomplete');
    expect(
      priceMapFromEnv({ STRIPE_PRICE_PRO_MONTHLY: 'a', STRIPE_PRICE_PRO_YEARLY: undefined }),
    ).toEqual({ pro: ['a'] });
    expect(priceMapFromEnv({})).toEqual({});
    const rec = subscriptionToRecord(
      {
        id: 's',
        customer: { id: 'c' },
        status: 'trialing',
        current_period_start: 1,
        current_period_end: 2,
        items: { data: [{ price: { id: 'price_pro_month' } }] },
      },
      'u',
      priceMap,
    );
    expect(rec).toMatchObject({ providerCustomerId: 'c', status: 'trialing', planKey: 'pro' });
    expect(rec.periodEnd?.getTime()).toBe(2000);
  });
});
