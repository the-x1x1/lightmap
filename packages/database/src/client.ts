/**
 * Database client. One `postgres` (porsager) connection pool per process, wrapped by Drizzle.
 * Server-side only. `createDb` is a factory so tests and scripts can point at another database.
 */
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';
import * as schema from './schema.ts';
import type { SqlExecutor } from './migrate.ts';

export type Db = PostgresJsDatabase<typeof schema>;

export interface DbHandle {
  db: Db;
  sql: Sql;
  executor: SqlExecutor;
  close(): Promise<void>;
}

export function createDb(url: string, opts: { max?: number } = {}): DbHandle {
  const sql = postgres(url, { max: opts.max ?? 8, idle_timeout: 30, connect_timeout: 10, prepare: true, onnotice: () => {} });
  const db = drizzle(sql, { schema });
  return { db, sql, executor: executorFor(sql), close: () => sql.end({ timeout: 5 }) };
}

/** Adapt the postgres.js tagged-template client to the migration runner's plain interface. */
export function executorFor(sql: Sql): SqlExecutor {
  return {
    unsafe: (text) => sql.unsafe(text),
    query: async <T>(text: string, params: unknown[] = []) => (await sql.unsafe(text, params as never)) as unknown as T[],
    begin: (fn) => sql.begin((tx) => fn(executorFor(tx as unknown as Sql))) as Promise<never>,
  };
}

let shared: DbHandle | null = null;

/** Process-wide handle from DATABASE_URL; throws when unset so callers can degrade explicitly. */
export function getDb(url: string | undefined = process.env['DATABASE_URL']): DbHandle {
  if (!url) throw new Error('DATABASE_URL is not configured');
  shared ??= createDb(url);
  return shared;
}
