import { expect, test, type Page } from '@playwright/test';

/**
 * The plan's E2E (§32): open → search Kailua Beach → 31 May → 12:30 → verify source/confidence →
 * clear → overcast changes the visuals → save project → reload → viewpoint persists.
 * Runs with fixture providers, so no network beyond localhost.
 */

async function pickKailua(page: Page) {
  await page.getByTestId('location-search').fill('Kailua');
  await page.getByTestId('location-results').getByRole('option').first().click();
  await expect(page.getByTestId('location-label')).toContainText('Kailua');
}

async function setDateTime(page: Page, date: string, minutes: number) {
  await page.getByTestId('date-input').fill(date);
  const range = page.getByTestId('timeline-range');
  await range.focus();
  await range.evaluate((el, m) => {
    const input = el as HTMLInputElement;
    input.value = String(m);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, minutes);
}

test('Kailua Beach, 31 May 2026, 12:30: light, source label, scenarios', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('map-shell')).toBeVisible();
  await pickKailua(page);
  await setDateTime(page, '2026-05-31', 12 * 60 + 30);
  await expect(page.getByTestId('timeline-time')).toHaveText('12:30');
  await expect(page.getByTestId('preview-time')).toHaveText('12:30');

  // Solar facts (USNO: transit 12:29, sun ~89° elevation, sunrise 05:48, sunset 19:09).
  await expect(page.getByTestId('preview-sunrise')).toHaveText('05:48');
  await expect(page.getByTestId('preview-sunset')).toHaveText('19:09');
  await expect(page.getByTestId('preview-sun')).toContainText('89° up');
  const overlay = page.getByTestId('sun-direction-overlay');
  await expect(overlay).toHaveAttribute('data-sun-elevation', /^89\./);

  // Source + confidence.
  const source = page.getByTestId('source-mode').first();
  await expect(source).toHaveAttribute('data-value', /SIMULATED_LIGHTING|ESTIMATED_PREVIEW/);
  await expect(page.getByTestId('confidence-astronomy')).toHaveAttribute('data-value', 'HIGH');

  // Scenario switching visibly changes the sky gradient and the direct-light figure.
  await page.getByTestId('scenario-clear').click();
  const clearDirect = await page.getByTestId('preview-scenario').locator('..').textContent();
  const skyClear = await page.getByTestId('preview-panel').locator('[title="Sky gradient for this moment"]').getAttribute('style');
  await page.getByTestId('scenario-overcast').click();
  const overDirect = await page.getByTestId('preview-scenario').locator('..').textContent();
  const skyOver = await page.getByTestId('preview-panel').locator('[title="Sky gradient for this moment"]').getAttribute('style');
  expect(clearDirect).toContain('100 % direct');
  expect(overDirect).toContain('20 % direct');
  expect(skyClear).not.toEqual(skyOver);

  // Scrubbing changes the light continuously.
  await setDateTime(page, '2026-05-31', 19 * 60 + 30);
  await expect(page.getByTestId('preview-light')).toContainText('blue hour');
  await expect(overlay).toHaveAttribute('data-sun-elevation', /^-/);
});

test('a date beyond the forecast horizon is labelled a scenario, never a forecast', async ({ page }) => {
  await page.goto('/');
  await pickKailua(page);
  const far = new Date();
  far.setDate(far.getDate() + 60);
  await setDateTime(page, far.toISOString().slice(0, 10), 12 * 60);
  await expect(page.getByTestId('scenario-badge')).toContainText(/scenario/i);
  await expect(page.getByTestId('scenario-summary')).toContainText(/unavailable this far ahead/i);
  await expect(page.getByTestId('confidence-weather')).toHaveAttribute('data-value', 'SCENARIO');
  await expect(page.getByTestId('scenario-forecast')).toHaveCount(0);
});

test('a date inside the horizon shows the (fixture) forecast and allows comparing scenarios', async ({ page }) => {
  await page.goto('/');
  await pickKailua(page);
  const soon = new Date();
  soon.setDate(soon.getDate() + 2);
  await setDateTime(page, soon.toISOString().slice(0, 10), 14 * 60);
  await expect(page.getByTestId('forecast-badge')).toContainText(/forecast/i);
  await page.getByTestId('scenario-clear').click();
  await expect(page.getByTestId('scenario-summary')).toContainText(/comparing scenario/i);
  await page.getByTestId('scenario-forecast').click();
  await expect(page.getByTestId('forecast-badge')).toBeVisible();
});

test('camera rotates and the heading readout follows', async ({ page }) => {
  await page.goto('/');
  await pickKailua(page);
  await page.getByTestId('camera-mode-viewpoint').click();
  const heading = page.locator('#lm-heading');
  await heading.evaluate((el) => {
    const input = el as HTMLInputElement;
    input.value = '270';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await expect(page.getByTestId('camera-heading')).toContainText('270° W');
  await page.getByTestId('lens-35').click();
  await expect(page.getByTestId('camera-controls')).toContainText('35 mm');
});

test('sign in (dev), create a project, save the viewpoint, reload and reopen it', async ({ page }) => {
  await page.goto('/');
  await pickKailua(page);
  await setDateTime(page, new Date().toISOString().slice(0, 10), 9 * 60);
  await page.getByTestId('panel-tab-account').click();
  await page.getByTestId('dev-login-email').fill(`e2e-${Date.now()}@example.com`);
  await page.getByTestId('dev-login-submit').click();
  await page.waitForURL(/\//);
  await page.getByTestId('panel-tab-projects').click();
  await page.getByTestId('project-name').fill('Kailua sunrise');
  await page.getByTestId('project-create').click();
  await expect(page.getByTestId('project-card')).toContainText('Kailua sunrise');
  await page.getByTestId('viewpoint-label').fill('Beach, 9am');
  await page.getByTestId('viewpoint-save').click();
  await expect(page.getByTestId('viewpoint-card')).toContainText('Beach, 9am');

  await page.reload();
  await page.getByTestId('panel-tab-projects').click();
  await page.getByTestId('project-card').click();
  await expect(page.getByTestId('viewpoint-card')).toContainText('Beach, 9am');
  await page.getByTestId('viewpoint-open').click();
  await expect(page.getByTestId('timeline-time')).toHaveText('09:00');
  await expect(page.getByTestId('location-label')).toContainText('Beach, 9am');
});

test('mobile: bottom sheet collapses and the map remains usable', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'mobile project only');
  await page.goto('/');
  await pickKailua(page);
  await page.getByRole('button', { name: 'Collapse panel' }).click();
  await expect(page.getByTestId('world-map')).toBeVisible();
  await page.getByRole('button', { name: 'Expand panel' }).click();
  await expect(page.getByTestId('timeline')).toBeVisible();
});
