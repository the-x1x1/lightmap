# LightMap, hosted: the web app with accounts, saved projects and Pro (docs/RUNBOOKS.md R0).
# Runs on any container host (Fly.io, Render, Railway, a VPS). Build from the repository root:
#
#   docker build -f deploy/Dockerfile -t lightmap .
#
# Run with the production settings of .env.example (DATABASE_URL, AUTH_SECRET, AUTH_URL,
# NEXT_PUBLIC_APP_URL, EMAIL_SERVER/EMAIL_FROM, STRIPE_*), then apply migrations once per release:
#
#   docker run --rm -e DATABASE_URL=... lightmap node --experimental-strip-types db/src/migrate-cli.ts

FROM node:22-bookworm-slim AS build
WORKDIR /repo
RUN corepack enable
COPY . .
# Hoisted node_modules: the standalone output then carries real files, not pnpm's links.
RUN pnpm install --frozen-lockfile --config.node-linker=hoisted
ENV NEXT_TELEMETRY_DISABLED=1
# LIGHTMAP_DESKTOP=1 turns on Next's standalone output (it changes nothing else at run time).
RUN LIGHTMAP_DESKTOP=1 pnpm --filter @lightmap/web build
RUN node apps/desktop/scripts/stage.mjs --target server --out /out

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build /out/server ./
# The migration runner and its SQL, resolved against the server's own node_modules.
COPY --from=build /repo/packages/database/src ./db/src
COPY --from=build /repo/packages/database/migrations ./db/migrations
# Next's image cache is the one place the server writes.
RUN mkdir -p apps/web/.next/cache && chown -R node:node apps/web/.next/cache
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "apps/web/server.js"]
