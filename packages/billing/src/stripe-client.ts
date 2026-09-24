/**
 * The only file that imports the Stripe SDK. Server-side only (plan §14.10: credentials stay on
 * the server). Everything the app needs from Stripe is behind `BillingProvider` so a different
 * processor could be added later without touching routes.
 */
import Stripe from 'stripe';
import { brand, type Env } from '@lightmap/config';
import type { StripeEventLike, StripeSubscriptionLike } from './webhook.ts';

export interface CheckoutRequest {
  userId: string;
  email: string;
  priceId: string;
  /** Existing Stripe customer id, if the user has one. */
  customerId?: string | null;
  successUrl: string;
  cancelUrl: string;
}

export interface BillingProvider {
  readonly configured: boolean;
  createCheckoutSession(req: CheckoutRequest): Promise<{ url: string; customerId: string | null }>;
  createPortalSession(customerId: string, returnUrl: string): Promise<{ url: string }>;
  /** Verify a webhook signature and return the event, or throw. */
  constructEvent(rawBody: string, signature: string): StripeEventLike;
  fetchSubscription(id: string): Promise<StripeSubscriptionLike | null>;
}

export class StripeBillingProvider implements BillingProvider {
  readonly configured: boolean;
  private readonly stripe: Stripe | null;
  private readonly webhookSecret: string | undefined;

  constructor(env: Pick<Env, 'STRIPE_SECRET_KEY' | 'STRIPE_WEBHOOK_SECRET'>) {
    this.configured = Boolean(env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET);
    this.stripe = env.STRIPE_SECRET_KEY
      ? new Stripe(env.STRIPE_SECRET_KEY, { appInfo: { name: brand.name, version: '0.1.0' } })
      : null;
    this.webhookSecret = env.STRIPE_WEBHOOK_SECRET;
  }

  private client(): Stripe {
    if (!this.stripe) throw new Error('Stripe is not configured');
    return this.stripe;
  }

  async createCheckoutSession(
    req: CheckoutRequest,
  ): Promise<{ url: string; customerId: string | null }> {
    const stripe = this.client();
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: req.priceId, quantity: 1 }],
      success_url: req.successUrl,
      cancel_url: req.cancelUrl,
      client_reference_id: req.userId,
      metadata: { userId: req.userId },
      subscription_data: { metadata: { userId: req.userId } },
      allow_promotion_codes: true,
      ...(req.customerId ? { customer: req.customerId } : { customer_email: req.email }),
    });
    if (!session.url) throw new Error('Stripe did not return a checkout URL');
    const customerId =
      typeof session.customer === 'string' ? session.customer : (session.customer?.id ?? null);
    return { url: session.url, customerId };
  }

  async createPortalSession(customerId: string, returnUrl: string): Promise<{ url: string }> {
    const session = await this.client().billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    });
    return { url: session.url };
  }

  constructEvent(rawBody: string, signature: string): StripeEventLike {
    if (!this.webhookSecret) throw new Error('STRIPE_WEBHOOK_SECRET is not configured');
    const event = this.client().webhooks.constructEvent(rawBody, signature, this.webhookSecret);
    return event;
  }

  async fetchSubscription(id: string): Promise<StripeSubscriptionLike | null> {
    try {
      const sub = await this.client().subscriptions.retrieve(id);
      return sub;
    } catch {
      return null;
    }
  }
}

/** Used when Stripe is not configured: the UI shows "billing not set up", never grants access. */
export class UnconfiguredBillingProvider implements BillingProvider {
  readonly configured = false;
  async createCheckoutSession(): Promise<never> {
    throw new Error('Billing is not configured');
  }
  async createPortalSession(): Promise<never> {
    throw new Error('Billing is not configured');
  }
  constructEvent(): never {
    throw new Error('Billing is not configured');
  }
  async fetchSubscription(): Promise<null> {
    return null;
  }
}

export function createBillingProvider(
  env: Pick<Env, 'STRIPE_SECRET_KEY' | 'STRIPE_WEBHOOK_SECRET'>,
): BillingProvider {
  return env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET
    ? new StripeBillingProvider(env)
    : new UnconfiguredBillingProvider();
}
