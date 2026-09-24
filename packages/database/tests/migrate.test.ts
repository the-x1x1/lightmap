import { describe, expect, it } from 'vitest';
import {
  loadMigrations,
  migrate,
  validateMigrationSet,
  type MigrationFile,
  type SqlExecutor,
} from '../src/migrate.ts';
import { isUlid, ulid } from '../src/ids.ts';

/** In-memory executor that records statements and remembers applied migrations. */
function fakeDb() {
  const applied = new Map<string, string>();
  const statements: string[] = [];
  const exec: SqlExecutor = {
    unsafe: async (s) => {
      statements.push(s);
    },
    query: async <T>(s: string, params: unknown[] = []) => {
      statements.push(s);
      if (s.startsWith('SELECT name, checksum'))
        return [...applied].map(([name, checksum]) => ({ name, checksum })) as T[];
      if (s.startsWith('INSERT INTO schema_migrations'))
        applied.set(params[0] as string, params[1] as string);
      return [] as T[];
    },
    begin: async (fn) => fn(exec),
  };
  return { exec, applied, statements };
}

describe('migration runner', () => {
  it('loads the real migration files in order and they validate', async () => {
    const files = await loadMigrations();
    expect(files.map((f) => f.name)).toEqual([
      '0001_initial.sql',
      '0002_postgis_optional.sql',
      '0003_viewpoint_variants.sql',
    ]);
    expect(validateMigrationSet(files)).toEqual([]);
    expect(files[0]!.sql).toContain('CREATE TABLE IF NOT EXISTS viewpoints');
    expect(files[1]!.sql).toContain('pg_available_extensions');
    expect(files[2]!.sql).toContain('parent_viewpoint_id');
  });

  it('applies once, skips on rerun, and refuses modified files', async () => {
    const files = await loadMigrations();
    const { exec, statements } = fakeDb();
    const first = await migrate(exec, files);
    expect(first.applied).toHaveLength(files.length);
    const second = await migrate(exec, files);
    expect(second.applied).toHaveLength(0);
    expect(second.skipped).toHaveLength(files.length);
    expect(statements.some((s) => s.includes('CREATE TABLE IF NOT EXISTS schema_migrations'))).toBe(
      true,
    );
    const tampered: MigrationFile[] = [
      { ...files[0]!, sql: files[0]!.sql + '\n-- edited', checksum: 'nope' },
      ...files.slice(1),
    ];
    await expect(migrate(exec, tampered)).rejects.toThrow('modified after being applied');
  });

  it('flags disordered, duplicate, empty and destructive files', () => {
    const problems = validateMigrationSet([
      { name: '0002_b.sql', sql: 'select 1', checksum: 'a' },
      { name: '0001_a.sql', sql: '', checksum: 'b' },
      { name: '0001_a.sql', sql: 'DROP TABLE users', checksum: 'c' },
    ]);
    expect(problems.join('\n')).toContain('out of order');
    expect(problems.join('\n')).toContain('empty');
    expect(problems.join('\n')).toContain('duplicate');
    expect(problems.join('\n')).toContain('drops a table');
  });
});

describe('ulid', () => {
  it('is 26 chars, sortable by time and validated', () => {
    const a = ulid(1_000_000);
    const b = ulid(2_000_000);
    expect(a).toHaveLength(26);
    expect(isUlid(a)).toBe(true);
    expect(a < b).toBe(true);
    expect(isUlid('not-an-id')).toBe(false);
    expect(ulid()).not.toBe(ulid());
  });
});
