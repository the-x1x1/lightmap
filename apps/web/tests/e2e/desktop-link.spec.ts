import { expect, test } from '@playwright/test';

/**
 * The website's half of a desktop app's sign-in (docs/SECURITY_MODEL.md "Desktop sign-in"): the
 * app asks for a link server to server (no cookies, no Origin), the person approves its code on
 * /link while signed in, the app's poll trades its secret for a device token once, and that token
 * is the account until the app signs out.
 */
test('a desktop app signs in through the browser: code, approval, one token, sign-out', async ({
  page,
  request,
  isMobile,
}) => {
  test.skip(isMobile, 'the website flow is the same on a phone; once is enough');
  test.slow();

  const start = await request.post('/api/desktop/link', { data: { deviceName: 'E2E Studio Mac' } });
  expect(start.status()).toBe(201);
  const { code, pollSecret, verifyUrl } = (await start.json()) as {
    code: string;
    pollSecret: string;
    verifyUrl: string;
  };
  expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  expect(verifyUrl).toContain(`/link?code=${code}`);
  // Nothing is granted before the approval.
  expect((await request.post('/api/desktop/link/poll', { data: { pollSecret } })).status()).toBe(
    202,
  );

  // The person signs in on the website (dev sign-in here), then opens the app's page.
  await page.goto('/');
  await page.getByTestId('panel-tab-account').click();
  await page.getByTestId('dev-login-email').fill(`e2e-link-${Date.now()}@example.com`);
  await page.getByTestId('dev-login-submit').click();
  await expect(page.getByTestId('account-button')).toHaveAttribute('data-signed-in', 'true');
  await page.goto(`/link?code=${encodeURIComponent(code)}`);
  await expect(page.getByTestId('link-device')).toContainText('E2E Studio Mac');
  await expect(page.getByTestId('link-code')).toHaveText(code);
  await page.getByTestId('link-approve').click();
  await expect(page.getByTestId('link-approved')).toBeVisible();

  // The app's next poll gets its token; the link is spent after that.
  const poll = await request.post('/api/desktop/link/poll', { data: { pollSecret } });
  expect(poll.status()).toBe(200);
  const { token } = (await poll.json()) as { token: string };
  expect(token).toMatch(/^lmd_/);
  expect((await request.post('/api/desktop/link/poll', { data: { pollSecret } })).status()).toBe(
    410,
  );

  // The token is the account: the plan, and the projects.
  const auth = { authorization: `Bearer ${token}` };
  const ent = await request.get('/api/account/entitlements', { headers: auth });
  expect(((await ent.json()) as { signedIn: boolean }).signedIn).toBe(true);
  expect((await request.get('/api/projects', { headers: auth })).status()).toBe(200);
  // The account lists the device, from the browser.
  const devices = await page.request.get('/api/account/devices');
  expect(JSON.stringify(await devices.json())).toContain('E2E Studio Mac');

  // Signing the app out revokes the token.
  expect((await request.delete('/api/desktop/token', { headers: auth })).status()).toBe(200);
  const after = await request.get('/api/account/entitlements', { headers: auth });
  expect(((await after.json()) as { signedIn: boolean }).signedIn).toBe(false);
  expect((await request.get('/api/projects', { headers: auth })).status()).toBe(401);
});
