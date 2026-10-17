// Only Next and the package version: nothing that loads the services.
import { NextResponse } from 'next/server';
import pkg from '../../../package.json' with { type: 'json' };

export const dynamic = 'force-dynamic';

/**
 * The desktop shells' start probe: answers as soon as the server is up, without loading the
 * services (/api/health builds them all - billing, database, auth, the time-zone data - which
 * took 3-7 s on the first request and held the window back; measured in the 0.3.2 Windows app's
 * log). The shell warms /api/health in the background once this answers.
 */
export function GET() {
  return NextResponse.json({
    ok: true,
    ready: true,
    version: (pkg as { version?: string }).version ?? '0.0.0',
  });
}
