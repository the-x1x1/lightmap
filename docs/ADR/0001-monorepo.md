# ADR-0001: Monorepo with pnpm workspaces and Turborepo

**Status:** Accepted · **Date:** 2026-09 · **Plan:** §13, §22

## Context

LightMap has one web application and roughly a dozen domain packages (astronomy, weather,
geospatial, scene, renderer, entitlements, billing, auth, database, config, observability, ui) that
must share types and be tested in isolation. The plan calls for one language (TypeScript), strict
typing, and a first milestone that ends with a running product, not a build system. Domain packages
must be testable without a bundler so calculation tests run fast and often.

## Decision

- **pnpm workspaces + Turborepo.** `pnpm-workspace.yaml` lists `apps/*` and `packages/*`; `turbo.json`
  defines `build`, `typecheck`, `test` with caching. pnpm is the only package manager
  (`packageManager` pinned, `engines.pnpm >= 10`).
- **TypeScript strict everywhere** from `tsconfig.base.json`: `strict`, `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, `noImplicitOverride`, `isolatedModules`, and crucially
  **`erasableSyntaxOnly`** and **`verbatimModuleSyntax`**. Together these guarantee that every
  source file is valid JavaScript once types are stripped: no `enum`, no parameter properties, no
  namespaces, explicit `import type`.
- **Packages are consumed as source.** No package has a build step. The web app lists every
  `@lightmap/*` package in Next.js `transpilePackages`; imports use explicit `.ts` extensions
  (`allowImportingTsExtensions` + `rewriteRelativeImportExtensions`).
- **Node ≥ 22.12** so tests and scripts run under native type stripping
  (`node --experimental-strip-types`). Vitest runs the same source; `scripts/*.ts` run with plain
  Node before any install-time tooling exists.

## Consequences

- One `pnpm install`, one typecheck, one test command; Turborepo caches unaffected packages.
- Zero build artefacts for packages; no stale `dist/` bugs; refactors across package boundaries are
  a single commit.
- `erasableSyntaxOnly` forbids some TypeScript conveniences (enums, parameter properties). Unions of
  string literals and `as const` arrays replace enums throughout.
- Every workspace shares one version number (bumped by `scripts/release.ts`).
- Packages cannot be published to npm as-is; that is not a goal.
- Contributors need Node 22.12+; CI pins Node 22.

## Alternatives considered

- **Single Next.js app with `src/lib` folders.** Faster to start, but domain code would drift into
  React components and could not be tested or reused (native mobile later) independently.
- **Nx.** More features than needed; Turborepo's task graph is sufficient and simpler.
- **Built packages (`tsc`/`tsup` per package).** Adds a build step before every test and a class of
  stale-output bugs; native type stripping made it unnecessary.
- **Bun or Deno runtime.** Attractive for TS execution, but Next.js and the wider tooling target
  Node; Node 22's type stripping closed the gap.
