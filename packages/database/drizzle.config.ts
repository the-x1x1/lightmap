import type { Config } from 'drizzle-kit';

/**
 * drizzle-kit is used only to diff the TypeScript schema against a database when authoring a new
 * migration (`pnpm --filter @lightmap/database generate`). Migrations are applied by
 * src/migrate.ts, which reads migrations/*.sql in order — no drizzle-kit at runtime.
 */
export default {
  schema: './src/schema.ts',
  out: './migrations/drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env['DATABASE_URL'] ?? 'postgres://lightmap:lightmap@localhost:5432/lightmap',
  },
} satisfies Config;
