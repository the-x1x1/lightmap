import { NextResponse, type NextRequest } from 'next/server';

/**
 * Per-request Content-Security-Policy with a nonce (plan §29). Next.js reads the nonce from the
 * incoming CSP header and applies it to its own inline scripts, so `script-src` needs neither
 * 'unsafe-inline' nor 'unsafe-eval'. Policy text lives in lib/csp.ts (unit tested).
 */
import { buildCsp } from '@/lib/csp';

export function middleware(request: NextRequest) {
  const nonce = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('base64');
  const csp = buildCsp(nonce, process.env.NODE_ENV === 'development');
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', csp);
  return response;
}

export const config = {
  // Pages only: API routes and static assets do not carry inline scripts.
  matcher: [
    {
      source:
        '/((?!api|_next/static|_next/image|cesium|favicon.ico|icon.svg|robots.txt|manifest.webmanifest).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
