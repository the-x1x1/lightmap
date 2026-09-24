# Security Policy

## Reporting

Email security@formicaria.us. Do not open public issues for vulnerabilities. We acknowledge
within 3 business days.

## Scope

- The web application (`apps/web`) and its API routes.
- Authentication (Auth.js), billing webhooks (Stripe), and data access (Drizzle/PostgreSQL).

## What we promise

- Provider credentials are server-side only; the browser receives no third-party secrets.
- Stripe webhooks are signature-verified and processed idempotently.
- Every project/viewpoint mutation checks ownership; IDs are not authorization.
- Security headers and a Content Security Policy are set in `apps/web/next.config.ts`.
- Dependencies are scanned in CI (`.github/workflows/security.yml`).

See `docs/SECURITY_MODEL.md` for the threat model.
