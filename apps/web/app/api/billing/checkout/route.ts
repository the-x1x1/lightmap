import { subscriptionsRepo } from '@lightmap/database';
import { HttpError, errorResponse, json, readJson, v } from '@/lib/server/http';
import { getServices } from '@/lib/server/services';
import { requireDb, requireUser } from '@/lib/server/session';

export const dynamic = 'force-dynamic';

/** Start a Stripe Checkout session for Pro. Price ids come from env; the client picks an interval only. */
export async function POST(req: Request) {
  try {
    const s = getServices();
    const ctx = await requireUser();
    const db = requireDb();
    if (!s.billing.configured) throw new HttpError(503, 'billing_unconfigured', 'Billing is not set up on this server yet.');
    const { interval } = await readJson(req, (b) => ({ interval: v.oneOf(v.obj(b)['interval'], 'interval', ['monthly', 'yearly'] as const)! }));
    const priceId = interval === 'yearly' ? s.env.STRIPE_PRICE_PRO_YEARLY : s.env.STRIPE_PRICE_PRO_MONTHLY;
    if (!priceId) throw new HttpError(503, 'billing_unconfigured', `No ${interval} price configured.`);
    const existing = await subscriptionsRepo(db).forUser(ctx.user.id);
    const base = s.env.NEXT_PUBLIC_APP_URL;
    const { url } = await s.billing.createCheckoutSession({ userId: ctx.user.id, email: ctx.user.email, priceId, customerId: existing?.providerCustomerId ?? null, successUrl: `${base}/account?checkout=success`, cancelUrl: `${base}/account?checkout=cancelled` });
    return json({ url });
  } catch (e) {
    return errorResponse(e);
  }
}
