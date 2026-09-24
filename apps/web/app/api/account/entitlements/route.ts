import { errorResponse, json } from '@/lib/server/http';
import { requestContext } from '@/lib/server/session';
import type { EntitlementsResponse } from '@/lib/api-types';

export const dynamic = 'force-dynamic';

/** The client's only source of plan truth: a server-derived snapshot (plan §15 "never trust a client-supplied tier"). */
export async function GET() {
  try {
    const ctx = await requestContext();
    const body: EntitlementsResponse = {
      signedIn: ctx.user !== null,
      user: ctx.user ? { id: ctx.user.id, email: ctx.user.email, displayName: ctx.user.displayName } : null,
      entitlements: ctx.entitlements,
      subscription: ctx.subscription
        ? { status: ctx.subscription.status, planKey: ctx.subscription.planKey, periodEnd: ctx.subscription.periodEnd?.toISOString() ?? null, cancelAtPeriodEnd: ctx.subscription.cancelAtPeriodEnd, hasCustomer: Boolean(ctx.subscription.providerCustomerId) }
        : null,
    };
    return json(body, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (e) {
    return errorResponse(e);
  }
}
