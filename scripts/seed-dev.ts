/**
 * `pnpm db:seed` — development fixtures only (plan §33): a dev user, one project and the six dev
 * locations as saved viewpoints at their local noon today. Refuses to run in production.
 */
import { createDb } from '../packages/database/src/client.ts';
import { schema, ulid } from '../packages/database/src/index.ts';
import { DEV_LOCATIONS } from '../packages/geospatial/src/providers/fixtures.ts';
import { localSelectionToUtc, utcToWallClock } from '../packages/astronomy/src/index.ts';

if (process.env['NODE_ENV'] === 'production') {
  console.error('seed-dev refuses to run in production');
  process.exit(1);
}
const url = process.env['DATABASE_URL'];
if (!url) {
  console.error('DATABASE_URL is not set');
  process.exit(2);
}
const handle = createDb(url, { max: 1 });
const { db } = handle;
try {
  const email = 'dev@lightmap.local';
  const [user] = await db
    .insert(schema.users)
    .values({ id: ulid(), email, emailVerified: new Date(), name: 'Dev' })
    .onConflictDoNothing()
    .returning();
  const u = user ?? (await db.query.users.findFirst({ where: (t, { eq }) => eq(t.email, email) }));
  if (!u) throw new Error('could not create dev user');
  await db.insert(schema.profiles).values({ userId: u.id }).onConflictDoNothing();
  const [project] = await db
    .insert(schema.projects)
    .values({
      id: ulid(),
      userId: u.id,
      name: 'Dev locations',
      description: 'Seeded fixtures — not real shoots',
    })
    .returning();
  for (const loc of DEV_LOCATIONS) {
    const now = utcToWallClock(new Date(), loc.timezone);
    const utc = localSelectionToUtc(now, 12 * 60, loc.timezone);
    await db.insert(schema.viewpoints).values({
      id: ulid(),
      projectId: project!.id,
      userId: u.id,
      label: loc.label,
      latitude: loc.point.latitude,
      longitude: loc.point.longitude,
      elevationM: loc.point.elevationM ?? null,
      timezone: loc.timezone,
      headingDeg: 90,
      pitchDeg: 0,
      fieldOfViewDeg: 73.7,
      focalLengthEquivalentMm: 24,
      selectedDatetimeUtc: utc,
      weatherMode: 'SCENARIO',
      weatherScenario: 'clear',
      previewSourceType: 'ESTIMATED_PREVIEW',
    });
  }
  console.log(`seeded ${DEV_LOCATIONS.length} viewpoints for ${email} (sign in with Dev sign-in)`);
} finally {
  await handle.close();
}
