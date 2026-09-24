import { request, type FullConfig } from '@playwright/test';

/**
 * `next dev` compiles each page and API route on its first request, and a compile that lands while
 * a test is running makes Next.js reload open pages ("Fast Refresh had to perform a full reload"),
 * which wipes the planner's state mid-test. Request everything the tests touch once, up front, so
 * the suite runs against a fully compiled server. The status codes don't matter here (401/400 are
 * fine); only that each route has been built.
 */
const ROUTES = [
  '/',
  '/account/sign-in',
  '/manifest.webmanifest',
  '/api/health',
  '/api/scene/capabilities',
  '/api/location/search?q=Kailua',
  '/api/location/reverse?lat=21.397&lng=-157.727',
  '/api/solar/day?lat=21.397&lng=-157.727&date=2026-05-31&tz=Pacific%2FHonolulu',
  '/api/weather?lat=21.397&lng=-157.727&date=2026-05-31&tz=Pacific%2FHonolulu',
  '/api/climatology?lat=21.397&lng=-157.727&month=5&tz=Pacific%2FHonolulu',
  '/api/account/entitlements',
  '/api/auth/session',
  '/api/auth/providers',
  '/api/auth/csrf',
  '/api/projects',
];

export default async function warmup(config: FullConfig): Promise<void> {
  const baseURL = config.projects[0]?.use.baseURL ?? 'http://localhost:3100';
  const ctx = await request.newContext({ baseURL });
  try {
    for (const route of ROUTES) {
      try {
        await ctx.get(route, { timeout: 180_000, failOnStatusCode: false, maxRedirects: 0 });
      } catch (e) {
        console.warn(`warm-up: ${route} failed (${String(e)})`);
      }
    }
  } finally {
    await ctx.dispose();
  }
}
