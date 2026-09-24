import { json } from '@/lib/server/http';
import { APP_VERSION, getServices } from '@/lib/server/services';

export const dynamic = 'force-dynamic';

export async function GET() {
  const s = getServices();
  let database: 'ok' | 'unconfigured' | 'error' = 'unconfigured';
  if (s.db) {
    try {
      await s.db.sql`select 1`;
      database = 'ok';
    } catch {
      database = 'error';
    }
  }
  return json(
    {
      ok: database !== 'error',
      version: APP_VERSION,
      database,
      fixtureMode: s.capabilities.fixtureMode,
    },
    { status: database === 'error' ? 503 : 200 },
  );
}
