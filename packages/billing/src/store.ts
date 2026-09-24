/** BillingStore backed by the database repositories. */
import { auditRepo, subscriptionsRepo, usersRepo, type Db } from '@lightmap/database';
import type { BillingStore, SubscriptionUpsert } from './webhook.ts';

export function databaseBillingStore(db: Db): BillingStore & { linkCustomer(userId: string, customerId: string): Promise<void> } {
  const subs = subscriptionsRepo(db);
  const audit = auditRepo(db);
  const users = usersRepo(db);
  return {
    recordEvent: (e) => subs.recordEvent({ provider: 'stripe', ...e }),
    wasProcessed: (id) => subs.wasProcessed('stripe', id),
    async userIdForCustomer(customerId) {
      const s = await subs.forCustomer(customerId);
      return s?.userId ?? null;
    },
    async upsertSubscription(s: SubscriptionUpsert) {
      const user = await users.byId(s.userId);
      if (!user) throw new Error(`subscription for unknown user ${s.userId}`);
      await subs.upsert({ provider: 'stripe', ...s });
    },
    audit: (action, userId, metadata) => audit.record(action, userId, metadata),
    async linkCustomer(userId, customerId) {
      const existing = await subs.forUser(userId);
      if (existing) return;
      // A placeholder record so the customer ↔ user mapping exists before the first subscription event.
      await subs.upsert({ provider: 'stripe', userId, providerCustomerId: customerId, providerSubscriptionId: null, status: 'incomplete', planKey: 'free', priceId: null, periodStart: null, periodEnd: null, cancelAtPeriodEnd: false });
    },
  };
}
