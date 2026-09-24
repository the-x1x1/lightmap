import { subscriptionsRepo } from '@lightmap/database';
import { HttpError, errorResponse, json } from '@/lib/server/http';
import { getServices } from '@/lib/server/services';
import { requireDb, requireUser } from '@/lib/server/session';

export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    const s = getServices();
    const ctx = await requireUser();
    if (!s.billing.configured)
      throw new HttpError(503, 'billing_unconfigured', 'Billing is not set up on this server yet.');
    const sub = await subscriptionsRepo(requireDb()).forUser(ctx.user.id);
    if (!sub?.providerCustomerId)
      throw new HttpError(
        404,
        'no_customer',
        'No billing account yet — start a subscription first.',
      );
    const { url } = await s.billing.createPortalSession(
      sub.providerCustomerId,
      `${s.env.NEXT_PUBLIC_APP_URL}/account`,
    );
    return json({ url });
  } catch (e) {
    return errorResponse(e);
  }
}
