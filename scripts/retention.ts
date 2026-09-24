/**
 * Retention job (docs/PRIVACY.md): erase accounts whose deletion request is older than 14 days,
 * purge expired provider cache rows. Run daily (cron / scheduled function). Idempotent.
 */
import { createDb } from '../packages/database/src/client.ts';
import {
  auditRepo,
  cacheRepo,
  retentionRepo,
  usersRepo,
} from '../packages/database/src/repositories.ts';

const url = process.env['DATABASE_URL'];
if (!url) {
  console.error('DATABASE_URL is not set');
  process.exit(2);
}
const dryRun = process.argv.includes('--dry-run');
const handle = createDb(url, { max: 1 });
try {
  const due = await retentionRepo(handle.db).usersDueForErasure(14);
  for (const u of due) {
    if (dryRun) {
      console.log(`would erase user ${u.id} (requested ${u.requestedAt.toISOString()})`);
      continue;
    }
    await usersRepo(handle.db).erase(u.id);
    await auditRepo(handle.db).record('account.erased', null, {
      userIdHash: u.id.slice(0, 8),
      requestedAt: u.requestedAt.toISOString(),
    });
    console.log(`erased user ${u.id}`);
  }
  const purged = dryRun ? 0 : await cacheRepo(handle.db).purgeExpired();
  console.log(
    `retention: ${due.length} account(s) due, ${purged} cache rows purged${dryRun ? ' (dry run)' : ''}`,
  );
} finally {
  await handle.close();
}
