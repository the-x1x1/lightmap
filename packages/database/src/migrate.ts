/**
 * Boring migration runner: applies migrations/*.sql in filename order inside a transaction each,
 * recording them in `schema_migrations`. No framework at runtime; the SQL files are the truth
 * and are reviewable in a PR. Re-running is a no-op. Rollback is by forward migration (documented
 * in docs/RELEASE_PROCESS.md) — the runner refuses to apply a file whose checksum changed after
 * it was recorded, which is how a silently edited migration is caught.
 */
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface MigrationFile {
  name: string;
  sql: string;
  checksum: string;
}

export interface SqlExecutor {
  /** Execute raw SQL without parameters. */
  unsafe(sql: string): Promise<unknown>;
  /** Parameterised query returning rows. */
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  begin<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T>;
}

export const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

export async function loadMigrations(dir: string = MIGRATIONS_DIR): Promise<MigrationFile[]> {
  const names = (await readdir(dir)).filter((n) => /^\d{4}_.+\.sql$/.test(n)).sort();
  const out: MigrationFile[] = [];
  for (const name of names) {
    const sql = await readFile(join(dir, name), 'utf8');
    out.push({ name, sql, checksum: createHash('sha256').update(sql).digest('hex') });
  }
  return out;
}

export interface MigrateResult {
  applied: string[];
  skipped: string[];
  notices: string[];
}

export async function migrate(
  db: SqlExecutor,
  migrations?: MigrationFile[],
  log: (line: string) => void = () => {},
): Promise<MigrateResult> {
  const files = migrations ?? (await loadMigrations());
  await db.unsafe(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name text PRIMARY KEY,
    checksum text NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);
  const rows = await db.query<{ name: string; checksum: string }>(
    'SELECT name, checksum FROM schema_migrations',
  );
  const done = new Map(rows.map((r) => [r.name, r.checksum]));
  const result: MigrateResult = { applied: [], skipped: [], notices: [] };
  for (const m of files) {
    const existing = done.get(m.name);
    if (existing !== undefined) {
      if (existing !== m.checksum)
        throw new Error(
          `Migration ${m.name} was modified after being applied (checksum mismatch). Write a new migration instead.`,
        );
      result.skipped.push(m.name);
      continue;
    }
    log(`applying ${m.name}`);
    await db.begin(async (tx) => {
      await tx.unsafe(m.sql);
      await tx.query('INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)', [
        m.name,
        m.checksum,
      ]);
    });
    result.applied.push(m.name);
  }
  return result;
}

/** Validate the migration set without a database: names ordered, unique, non-empty (CI gate). */
export function validateMigrationSet(files: MigrationFile[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  let last = -1;
  for (const f of files) {
    const n = Number(f.name.slice(0, 4));
    if (seen.has(f.name)) problems.push(`duplicate ${f.name}`);
    seen.add(f.name);
    if (n <= last) problems.push(`${f.name} is out of order`);
    last = n;
    if (f.sql.trim().length === 0) problems.push(`${f.name} is empty`);
    if (/\bDROP\s+TABLE\b(?!.*IF EXISTS)/i.test(f.sql))
      problems.push(`${f.name} drops a table without IF EXISTS`);
  }
  return problems;
}
