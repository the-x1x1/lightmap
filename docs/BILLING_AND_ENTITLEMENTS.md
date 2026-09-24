# Billing and Entitlements

Source of truth: `packages/entitlements/src/index.ts` (pure derivation), `packages/billing/src/webhook.ts`
(pure webhook processing over a `BillingStore`), `apps/web/app/api/webhooks/stripe` (signature
verification and persistence), `apps/web/app/api/account/entitlements` (client snapshot).

Guiding rule (plan §15): no `if (plan === 'pro')` anywhere in the UI or API. Everything asks
`can(snapshot, key, context)`.

## 1. Entitlement keys

| Key | Meaning |
|---|---|
| `map_access` | Use the map, timeline and scenarios |
| `future_date_planning` | Plan beyond the free date window |
| `saved_projects` | Create projects (subject to limits) |
| `saved_viewpoints` | Save viewpoints (subject to limits) |
| `forecast_detail` | Hourly forecast detail and scenario comparison |
| `high_quality_preview` | Request render quality above the plan ceiling |
| `export_preview` | Planning-card export |
| `moon_planning` | Moon position, phase and rise/set planning |
| `advanced_camera_tools` | Lens presets, heading and pitch controls |

## 2. Plans and limits

| | `free` | `pro` (Photographer Pro) | `studio` |
|---|---|---|---|
| Entitlements | map_access, saved_projects, saved_viewpoints, moon_planning | all nine | all nine |
| `futureDateWindowDays` | 14 | unlimited | unlimited |
| `pastDateWindowDays` | 7 | unlimited | unlimited |
| `maxProjects` | 1 | unlimited | unlimited |
| `maxViewpointsPerProject` | 3 | 200 | 500 |
| `maxViewpointsTotal` | 3 | 5,000 | 50,000 |
| `maxPreviewQuality` | 1 | 3 | 3 |

Studio is a plan definition only: it has no Stripe price and no team features yet (plan §15 "later").

`can()` semantics worth knowing:

- `future_date_planning` for a free user checks the date window: denied with
  "Free plans can plan up to 14 days ahead. This date is N days away." or "Free plans can look
  back 7 days."
- `saved_projects` / `saved_viewpoints` compare the current counts passed in context against the
  limits; the denial reason and `upgradeTo: 'pro'` feed the paywall.
- `high_quality_preview` allows any request at or below the plan's quality ceiling; above it, only
  plans holding the key.

## 3. Status rules

`deriveEntitlements(subscription, now)` produces the snapshot. `plan` is what the user bought;
`effectivePlan` is what applies after status rules.

| Stripe status | Effective plan | Notes |
|---|---|---|
| `active`, `trialing` | the plan | If `cancelAtPeriodEnd`, `accessEndsAt = periodEnd` |
| `past_due` | the plan for **7 days** after `periodEnd` (`PAST_DUE_GRACE_DAYS`), then free | `grace: true`; UI shows a fix-payment nudge but keeps access |
| `canceled` | the plan until `periodEnd`, then free | Access continues to the end of the paid period |
| `paused`, `unpaid`, `incomplete`, `incomplete_expired` | free | |
| no record | free, `status: 'none'` | |

The snapshot also carries `entitlements[]`, `limits`, `accessEndsAt` and `computedAt`.

## 4. Webhook pipeline

```
Stripe → POST /api/webhooks/stripe
  1. verify signature            Stripe SDK constructEvent(rawBody, sig, STRIPE_WEBHOOK_SECRET); 400 on failure
  2. idempotency                 event id recorded in subscription_events with ON CONFLICT DO NOTHING;
                                 a replay returns 'duplicate' and touches nothing
  3. resolve user                checkout: client_reference_id / metadata.userId → link customer ↔ user
                                 (a placeholder `free`/`incomplete` subscriptions row holds the mapping)
                                 otherwise: customer id → subscriptions.provider_customer_id → user_id
  4. upsert subscription         status, plan_key (from price id), price id, period, cancel_at_period_end
  5. derive entitlements         on the next GET /api/account/entitlements (no cached tier anywhere else)
  6. audit                       audit_events row per processed event (no PII)
```

`processWebhookEvent()` is pure over the `BillingStore` interface, so the whole pipeline is unit
tested without Stripe or a database. Outcomes: `processed`, `duplicate`, `ignored`, `unmapped`.

### Handled event types

`checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`,
`customer.subscription.deleted` (recorded as `canceled`), `customer.subscription.paused`,
`customer.subscription.resumed`, `customer.subscription.trial_will_end` (audit: notify user),
`invoice.payment_failed`, `invoice.payment_succeeded` (subscription re-read from Stripe),
`charge.refunded` (audit only; a refund does not change entitlement by itself — Stripe emits a
subscription update if the operator cancels).

Any other type is recorded as `ignored` and acknowledged with 200 so Stripe stops retrying.

### Safety rules

- **Unknown price → `free`, never Pro.** `planForPrice()` returns null for a price id not in the
  env map; the record is written as `free`. A misconfigured price can only under-grant.
- **Unmapped customer → `unmapped` + audit row `billing.unmapped_event`** for manual review. No
  subscription row is written for a user we cannot identify.
- **Never trust the client.** The client only ever receives the server-derived snapshot from
  `GET /api/account/entitlements`. There is no client-writable tier field anywhere.
- **Billing unavailable → no access granted.** Checkout and portal calls fail loudly; entitlements
  come only from stored subscription rows.
- Period fields are read from both the subscription object and its first item (Stripe API ≥ 2025
  moved them).

## 5. Checkout and portal

- `POST /api/billing/checkout` creates a Stripe Checkout session (subscription mode) with
  `client_reference_id = userId`, success/cancel URLs from `NEXT_PUBLIC_APP_URL`.
- `POST /api/billing/portal` opens the Stripe Customer Portal for cancellation, payment method
  changes and invoices.
- The paywall shows the denial reason from `can()` and the target plan's `highlights`.

## 6. Local development

```
stripe login
stripe listen --forward-to localhost:3000/api/webhooks/stripe
# copy the printed whsec_… into STRIPE_WEBHOOK_SECRET
stripe trigger checkout.session.completed
```

Use test-mode keys (`sk_test_…`) and test prices. The dev sign-in account can go through Checkout
with card `4242 4242 4242 4242`.

## 7. Environment variables

| Variable | Purpose |
|---|---|
| `STRIPE_SECRET_KEY` | Server-side API key. **A `sk_test_` key is refused in production** by env validation. |
| `STRIPE_WEBHOOK_SECRET` | Signing secret for the webhook endpoint (from the Dashboard or `stripe listen`). |
| `STRIPE_PRICE_PRO_MONTHLY` | Price id mapped to `pro`. |
| `STRIPE_PRICE_PRO_YEARLY` | Price id mapped to `pro`. |

When any of these is missing the billing routes return a clear "billing not configured" error and
nothing else in the app changes: free-plan behaviour applies.

## 8. Tables

`subscriptions` (one row per user; user_id, provider, provider_customer_id unique,
provider_subscription_id, status, plan_key, price_id, period_start, period_end,
cancel_at_period_end, updated_at) — this row is also the customer ↔ user link;
`subscription_events` ((provider, provider_event_id) unique, type, user_id nullable, payload,
outcome, created_at); `audit_events` (id, user_id nullable, action, metadata, created_at).
