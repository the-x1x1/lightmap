import { databaseBillingStore, priceMapFromEnv, processWebhookEvent } from '@lightmap/billing';
import { getServices } from '@/lib/server/services';

export const dynamic = 'force-dynamic';

/**
 * Stripe webhook (plan §15): verify signature → idempotent processing → subscription record.
 * Always answers 200 for events we understood (even duplicates) so Stripe stops retrying; 400 for
 * bad signatures; 500 only when our side failed and a retry might help.
 */
export async function POST(req: Request) {
  const s = getServices();
  if (!s.billing.configured || !s.db) return new Response('billing not configured', { status: 503 });
  const signature = req.headers.get('stripe-signature');
  if (!signature) return new Response('missing signature', { status: 400 });
  const raw = await req.text();
  let event;
  try {
    event = s.billing.constructEvent(raw, signature);
  } catch (error) {
    s.log.warn('stripe signature verification failed', { error });
    return new Response('invalid signature', { status: 400 });
  }
  try {
    const store = databaseBillingStore(s.db.db);
    const outcome = await processWebhookEvent(event, {
      store,
      priceMap: priceMapFromEnv(s.env),
      fetchSubscription: (id) => s.billing.fetchSubscription(id),
      linkCustomer: (userId, customerId) => store.linkCustomer(userId, customerId),
    });
    s.log.info('stripe event', { type: outcome.type, outcome: outcome.outcome, eventId: outcome.eventId });
    return Response.json({ received: true, outcome: outcome.outcome });
  } catch (error) {
    s.errors.capture(error, { eventId: event.id, type: event.type });
    return new Response('processing failed', { status: 500 });
  }
}
