# ADR-0005: Central entitlement derivation, server snapshot, idempotent webhooks

**Status:** Accepted · **Date:** 2026-09 · **Plan:** §15, §29, §38

## Context

LightMap charges a subscription from the first release. The plan forbids `if (plan === 'pro')`
scattered through the UI, requires that a client-supplied tier is never trusted, and requires that
webhook processing be idempotent. Stripe delivers events at least once, sometimes out of order, and
its API versions move fields (period dates moved onto subscription items in 2025). A billing outage
must never grant access by accident.

## Decision

1. **One pure derivation.** `packages/entitlements` defines the nine entitlement keys, the plan
   table (`free`, `pro`, `studio`) with limits, and `deriveEntitlements(subscriptionRecord, now)`
   → `EntitlementSnapshot`. Status rules live there and only there: active/trialing apply the plan;
   past_due keeps it for a 7-day grace after period end; canceled keeps it to period end; paused,
   unpaid, incomplete and incomplete_expired are free.
2. **One authorization question.** `can(snapshot, key, context)` returns `{ allowed, reason,
upgradeTo }`. The UI shows the reason on the paywall; API routes call the same function before
   every write. Limits (date window, project and viewpoint counts, quality ceiling) are context
   arguments, not UI constants.
3. **The server owns the snapshot.** The client receives it from
   `GET /api/account/entitlements` and caches it in TanStack Query; it is display state only. Every
   server check recomputes from the `subscriptions` row. There is no client-writable plan field.
4. **Webhook pipeline is pure over a store interface.** `processWebhookEvent(event, deps)` in
   `packages/billing` runs after the route has verified the Stripe signature. It records the event
   id in `subscription_events` with `ON CONFLICT DO NOTHING` (a replay returns `duplicate` and
   changes nothing), resolves the user via checkout metadata or the customer id, upserts the
   subscription, and writes an audit row. The Postgres-backed store and the unit-test fake implement
   the same `BillingStore`.
5. **Fail closed.** Unknown price id → `free` (never guess Pro). Unmapped customer → audit for
   review, no write. Unhandled event type → recorded as `ignored`, acknowledged. Refund → audit only;
   entitlement changes only when Stripe emits a subscription change. Billing routes unavailable →
   error, no grant. Test-mode key in production → env validation error.
6. **Stripe hosted surfaces.** Checkout and the Customer Portal handle payment details, cancellation
   and invoices; LightMap never touches card data.

## Consequences

- Plan changes (price, limits, a new key) are edits to one table in one package, covered by unit
  tests, and take effect everywhere.
- Webhook logic is tested exhaustively without Stripe or a database; the route is a thin adapter.
- A user who subscribes sees the plan unlock as soon as the webhook lands (the client refetches the
  snapshot); no page reload or re-login.
- Grace and period-end behaviour are predictable and documented for support.
- `studio` exists as a definition without a price; the paywall never offers it. Team features are
  future work.
- Snapshot freshness depends on webhook delivery; a delayed webhook delays the unlock. Stripe's retry
  plus idempotency makes this safe. The client query has a 60 s `staleTime` and is invalidated on
  account mutations; returning from Checkout refetches on focus. A manual "refresh entitlements"
  control is a small follow-up if support tickets show it is needed.

## Alternatives considered

- **Check `plan` inline in components and routes.** Rejected: untestable sprawl and inevitable
  inconsistencies between UI and API.
- **Trust Stripe Checkout's success redirect to unlock.** Rejected: the redirect is client-visible
  and forgeable; only the signed webhook (or a server-side Stripe API read) is authoritative.
- **Store entitlements as a materialised column updated by the webhook.** Considered; rejected for
  v0.1 because time-based rules (grace, period end) would go stale between events. Deriving at read
  time is cheap and always current. A cache can be added later without changing callers.
- **A hosted entitlement/billing service (e.g. a subscription SaaS on top of Stripe).** Rejected for
  cost and control; the surface area in v0.1 is small.
