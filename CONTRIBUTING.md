# Contributing

LightMap is a private commercial codebase. These rules keep it releasable.

## Ground rules

1. `main` is always releasable. Work on branches; open a PR; CI must be green.
2. Correct → honest → simple → fast → beautiful. Never reverse that order (plan §45).
3. Every external service sits behind a provider interface in `packages/*`. UI components never
   import an SDK.
4. Every visual preview carries a source label (Real Reference / Simulated Lighting / Estimated
   Preview) and a confidence breakdown. Do not remove or soften them.
5. No user uploads, no social features, no location-discovery feed. See `docs/PRODUCT_SPEC.md`
   § "What LightMap is not".
6. New data source ⇒ a row in `docs/DATA_SOURCES_AND_LICENSING.md` and an attribution string in
   the provider registry, in the same PR. CI fails otherwise.
7. New dependency ⇒ permissive licence (MIT/BSD/Apache-2.0/ISC/0BSD/Unlicense/CC0). Anything
   else needs an entry in `scripts/license-allowlist.json` with a written reason.

## Local loop

```sh
pnpm install
cp .env.example .env
pnpm env:validate
pnpm db:migrate
pnpm dev
```

```sh
pnpm typecheck && pnpm lint && pnpm test:unit
```

## Commit messages

Conventional-ish: `area: what changed and why`. Reference the plan section or ADR when the
change encodes a decision (`renderer: shadow darkness follows sun transmittance (ADR-0004)`).

## Architecture decisions

Anything that would surprise a future engineer goes in `docs/ADR/NNNN-title.md`.
