/**
 * Webhook processing (plan §15):
 *   Stripe webhook → verify signature (done by the caller with the Stripe SDK) → this module:
 *   idempotency check → update subscription record → derive entitlements → audit.
 *
 * This file is pure over a `BillingStore` interface so it is unit tested without Stripe or a
 * database. The only Stripe knowledge here is the shape of the event objects we read, declared as
 * minimal structural types — the SDK's own types are used in `stripe-client.ts`.
 */
import { planForPrice, type PlanKey, type SubscriptionStatus } from '@lightmap/entitlements';

export interface StripeSubscriptionLike {
  id: string;
  customer: string | { id: string };
  status: string;
  cancel_at_period_end?: boolean;
  /** Stripe ≥ 2025 moved period fields onto items; both are read. */
  current_period_start?: number;
  current_period_end?: number;
  items?: {
    data?: Array<{
      price?: { id?: string };
      current_period_start?: number;
      current_period_end?: number;
    }>;
  };
  metadata?: Record<string, string>;
}

export interface StripeCheckoutSessionLike {
  id: string;
  customer: string | { id: string } | null;
  subscription: string | { id: string } | null;
  client_reference_id?: string | null;
  metadata?: Record<string, string> | null;
  mode?: string;
}

export interface StripeInvoiceLike {
  id: string;
  customer: string | { id: string } | null;
  subscription?: string | { id: string } | null;
  /** Newer API versions nest the subscription under `parent`. */
  parent?: { subscription_details?: { subscription?: string | { id: string } } } | null;
}

export interface StripeChargeLike {
  id: string;
  customer: string | { id: string } | null;
  refunded?: boolean;
}

export interface StripeEventLike {
  id: string;
  type: string;
  created: number;
  data: { object: unknown };
}

export interface SubscriptionUpsert {
  userId: string;
  providerCustomerId: string;
  providerSubscriptionId: string | null;
  status: SubscriptionStatus;
  planKey: PlanKey;
  priceId: string | null;
  periodStart: Date | null;
  periodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
}

export interface BillingStore {
  /** Returns false when this event id was already recorded (idempotent replay). */
  recordEvent(e: {
    providerEventId: string;
    type: string;
    userId: string | null;
    payload: unknown;
    outcome: string;
  }): Promise<boolean>;
  wasProcessed(providerEventId: string): Promise<boolean>;
  userIdForCustomer(customerId: string): Promise<string | null>;
  upsertSubscription(s: SubscriptionUpsert): Promise<void>;
  /** Called when we cannot map a customer to a user; the event is stored for manual review. */
  audit(action: string, userId: string | null, metadata: Record<string, unknown>): Promise<void>;
}

export interface WebhookOutcome {
  eventId: string;
  type: string;
  /** 'processed' | 'duplicate' | 'ignored' | 'unmapped' */
  outcome: 'processed' | 'duplicate' | 'ignored' | 'unmapped';
  userId: string | null;
  detail?: string;
}

/** Stripe price id → plan, from env. Studio has no price yet (Phase 3+). */
export function priceMapFromEnv(env: {
  STRIPE_PRICE_PRO_MONTHLY?: string | undefined;
  STRIPE_PRICE_PRO_YEARLY?: string | undefined;
}): Partial<Record<PlanKey, string[]>> {
  const pro = [env.STRIPE_PRICE_PRO_MONTHLY, env.STRIPE_PRICE_PRO_YEARLY].filter(
    (v): v is string => typeof v === 'string' && v.length > 0,
  );
  return pro.length > 0 ? { pro } : {};
}

export const HANDLED_EVENT_TYPES = [
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'customer.subscription.paused',
  'customer.subscription.resumed',
  'customer.subscription.trial_will_end',
  'invoice.payment_failed',
  'invoice.payment_succeeded',
  'charge.refunded',
] as const;

const STATUS_VALUES: readonly SubscriptionStatus[] = [
  'trialing',
  'active',
  'past_due',
  'canceled',
  'unpaid',
  'incomplete',
  'incomplete_expired',
  'paused',
];

export function normalizeStatus(s: string): SubscriptionStatus {
  return (STATUS_VALUES as readonly string[]).includes(s)
    ? (s as SubscriptionStatus)
    : 'incomplete';
}

function idOf(v: string | { id: string } | null | undefined): string | null {
  if (!v) return null;
  return typeof v === 'string' ? v : v.id;
}

function periodOf(sub: StripeSubscriptionLike): { start: Date | null; end: Date | null } {
  const item = sub.items?.data?.[0];
  const start = sub.current_period_start ?? item?.current_period_start;
  const end = sub.current_period_end ?? item?.current_period_end;
  return { start: start ? new Date(start * 1000) : null, end: end ? new Date(end * 1000) : null };
}

/** Subscription object → our record (needs a user id resolved by the caller). */
export function subscriptionToRecord(
  sub: StripeSubscriptionLike,
  userId: string,
  priceMap: Partial<Record<PlanKey, string[]>>,
): SubscriptionUpsert {
  const priceId = sub.items?.data?.[0]?.price?.id ?? null;
  const plan =
    planForPrice(priceId, priceMap) ?? (sub.metadata?.['planKey'] as PlanKey | undefined) ?? null;
  const { start, end } = periodOf(sub);
  return {
    userId,
    providerCustomerId: idOf(sub.customer) ?? '',
    providerSubscriptionId: sub.id,
    // Unknown price ⇒ free. Never guess Pro from an unrecognised price (plan §15 "never trust").
    planKey: plan ?? 'free',
    status: normalizeStatus(sub.status),
    priceId,
    periodStart: start,
    periodEnd: end,
    cancelAtPeriodEnd: sub.cancel_at_period_end ?? false,
  };
}

export interface WebhookDeps {
  store: BillingStore;
  priceMap: Partial<Record<PlanKey, string[]>>;
  /** Fetch a subscription by id when an event only carries its id (invoice.*, checkout). */
  fetchSubscription: (id: string) => Promise<StripeSubscriptionLike | null>;
  /** Persist the customer ↔ user link discovered at checkout. */
  linkCustomer: (userId: string, customerId: string) => Promise<void>;
}

/**
 * Process one verified event. Idempotent: the event id is recorded first with ON CONFLICT DO
 * NOTHING; a replay returns 'duplicate' without touching the subscription.
 */
export async function processWebhookEvent(
  event: StripeEventLike,
  deps: WebhookDeps,
): Promise<WebhookOutcome> {
  const { store } = deps;
  if (await store.wasProcessed(event.id))
    return { eventId: event.id, type: event.type, outcome: 'duplicate', userId: null };
  if (!(HANDLED_EVENT_TYPES as readonly string[]).includes(event.type)) {
    await store.recordEvent({
      providerEventId: event.id,
      type: event.type,
      userId: null,
      payload: event.data.object,
      outcome: 'ignored',
    });
    return { eventId: event.id, type: event.type, outcome: 'ignored', userId: null };
  }

  let userId: string | null = null;
  let sub: StripeSubscriptionLike | null = null;
  let customerId: string | null = null;
  let detail: string | undefined;

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as StripeCheckoutSessionLike;
      customerId = idOf(session.customer);
      userId = session.client_reference_id ?? session.metadata?.['userId'] ?? null;
      if (userId && customerId) await deps.linkCustomer(userId, customerId);
      const subId = idOf(session.subscription);
      if (subId) sub = await deps.fetchSubscription(subId);
      detail = 'checkout completed';
      break;
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
    case 'customer.subscription.paused':
    case 'customer.subscription.resumed':
    case 'customer.subscription.trial_will_end': {
      sub = event.data.object as StripeSubscriptionLike;
      customerId = idOf(sub.customer);
      if (event.type === 'customer.subscription.deleted') sub = { ...sub, status: 'canceled' };
      if (event.type === 'customer.subscription.trial_will_end')
        detail = 'trial ending — notify user';
      break;
    }
    case 'invoice.payment_failed':
    case 'invoice.payment_succeeded': {
      const inv = event.data.object as StripeInvoiceLike;
      customerId = idOf(inv.customer);
      const subId = idOf(inv.subscription) ?? idOf(inv.parent?.subscription_details?.subscription);
      if (subId) sub = await deps.fetchSubscription(subId);
      detail =
        event.type === 'invoice.payment_failed'
          ? 'payment failed — subscription status re-read from Stripe'
          : 'payment succeeded';
      break;
    }
    case 'charge.refunded': {
      const charge = event.data.object as StripeChargeLike;
      customerId = idOf(charge.customer);
      // A refund does not by itself change entitlement; Stripe will emit a subscription update
      // if the operator cancels. Record for audit only.
      userId = customerId ? await store.userIdForCustomer(customerId) : null;
      await store.audit('billing.charge_refunded', userId, { chargeId: charge.id, customerId });
      await store.recordEvent({
        providerEventId: event.id,
        type: event.type,
        userId,
        payload: event.data.object,
        outcome: 'processed',
      });
      return {
        eventId: event.id,
        type: event.type,
        outcome: 'processed',
        userId,
        detail: 'refund recorded',
      };
    }
  }

  userId ??= customerId ? await store.userIdForCustomer(customerId) : null;
  // Stripe does not order events: subscription.created can arrive before checkout.session.completed
  // has linked the customer. The subscription carries our userId in metadata from checkout.
  const metaUser = sub?.metadata?.['userId'];
  if (!userId && metaUser && customerId) {
    userId = metaUser;
    await deps.linkCustomer(userId, customerId);
  }
  if (!userId) {
    await store.audit('billing.unmapped_event', null, {
      eventId: event.id,
      type: event.type,
      customerId,
    });
    await store.recordEvent({
      providerEventId: event.id,
      type: event.type,
      userId: null,
      payload: event.data.object,
      outcome: 'unmapped',
    });
    return {
      eventId: event.id,
      type: event.type,
      outcome: 'unmapped',
      userId: null,
      detail: 'no user for customer',
    };
  }

  // Apply the effect FIRST, then record the event. If the upsert throws, Stripe's retry finds the
  // event unrecorded and applies it again; the unique index still guards concurrent duplicates.
  if (sub) {
    await store.upsertSubscription(subscriptionToRecord(sub, userId, deps.priceMap));
  } else if (event.type === 'checkout.session.completed' && customerId) {
    // Checkout without a subscription object yet (subscription.created follows). Nothing to write.
    detail = 'checkout completed; awaiting subscription event';
  }
  const fresh = await store.recordEvent({
    providerEventId: event.id,
    type: event.type,
    userId,
    payload: event.data.object,
    outcome: 'processed',
  });
  if (!fresh) return { eventId: event.id, type: event.type, outcome: 'duplicate', userId };
  await store.audit(`billing.${event.type}`, userId, {
    eventId: event.id,
    subscriptionId: sub?.id ?? null,
    status: sub?.status ?? null,
  });
  return {
    eventId: event.id,
    type: event.type,
    outcome: 'processed',
    userId,
    ...(detail ? { detail } : {}),
  };
}
