import { createDb } from './client.ts';
import { loadMigrations, migrate, validateMigrationSet } from './migrate.ts';

const url = process.env['DATABASE_URL'];
if (!url) {
  console.error('DATABASE_URL is not set');
  process.exit(2);
}
const files = await loadMigrations();
const problems = validateMigrationSet(files);
if (problems.length > 0) {
  console.error('Invalid migration set:\n  ' + problems.join('\n  '));
  process.exit(1);
}
const handle = createDb(url, { max: 1 });
try {
  const result = await migrate(handle.executor, files, (l) => console.log(l));
  console.log(`applied ${result.applied.length}, already applied ${result.skipped.length}`);
} finally {
  await handle.close();
}
