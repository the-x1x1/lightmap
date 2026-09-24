import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * The plan's E2E (§32): open → search Kailua Beach → 31 May → 12:30 → verify source/confidence →
 * clear → overcast changes the visuals → save project → reload → viewpoint persists.
 * Runs with fixture providers, so no network beyond localhost.
 */

/** React overrides the value setter on inputs; use the prototype setter so onChange fires (utility-world fill() does not support range in all builds). */
async function setRangeValue(locator: Locator, value: number) {
  await locator.evaluate((el, v) => {
    const input = el as HTMLInputElement;
    // Call the prototype setter on the element itself (React patches the instance setter).
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
      input,
      String(v),
    );
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}

async function pickKailua(page: Page) {
  await page.getByTestId('location-search').fill('Kailua');
  await page.getByTestId('location-results').getByRole('option').first().click();
  await expect(page.getByTestId('location-label')).toContainText('Kailua');
}

async function setDateTime(page: Page, date: string, minutes: number) {
  await page.getByTestId('date-input').fill(date);
  const range = page.getByTestId('timeline-range');
  await range.focus();
  await setRangeValue(range, minutes);
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
  const skyClear = await page
    .getByTestId('preview-panel')
    .locator('[title="Sky gradient for this moment"]')
    .getAttribute('style');
  await page.getByTestId('scenario-overcast').click();
  const overDirect = await page.getByTestId('preview-scenario').locator('..').textContent();
  const skyOver = await page
    .getByTestId('preview-panel')
    .locator('[title="Sky gradient for this moment"]')
    .getAttribute('style');
  expect(clearDirect).toContain('100 % direct');
  expect(overDirect).toContain('20 % direct');
  expect(skyClear).not.toEqual(skyOver);

  // Scrubbing changes the light continuously.
  await setDateTime(page, '2026-05-31', 19 * 60 + 30);
  await expect(page.getByTestId('preview-light')).toContainText('blue hour');
  await expect(overlay).toHaveAttribute('data-sun-elevation', /^-/);
});

test('a date beyond the forecast horizon is labelled a scenario, never a forecast', async ({
  page,
}) => {
  await page.goto('/');
  await pickKailua(page);
  const far = new Date();
  far.setDate(far.getDate() + 60);
  await setDateTime(page, far.toISOString().slice(0, 10), 12 * 60);
  await expect(page.getByTestId('scenario-badge').first()).toContainText(/scenario/i);
  await expect(page.getByTestId('scenario-summary')).toContainText(/unavailable this far ahead/i);
  await expect(page.getByTestId('confidence-weather')).toHaveAttribute('data-value', 'SCENARIO');
  await expect(page.getByTestId('scenario-forecast')).toHaveCount(0);
});

test('a date inside the horizon shows the (fixture) forecast and allows comparing scenarios', async ({
  page,
}) => {
  await page.goto('/');
  await pickKailua(page);
  const soon = new Date();
  soon.setDate(soon.getDate() + 2);
  await setDateTime(page, soon.toISOString().slice(0, 10), 14 * 60);
  await expect(page.getByTestId('forecast-badge').first()).toContainText(/forecast/i);
  await page.getByTestId('scenario-clear').click();
  await expect(page.getByTestId('scenario-summary')).toContainText(/comparing scenario/i);
  await page.getByTestId('scenario-forecast').click();
  await expect(page.getByTestId('forecast-badge').first()).toBeVisible();
});

test('camera rotates and the heading readout follows', async ({ page }) => {
  await page.goto('/');
  await pickKailua(page);
  await page.getByTestId('camera-mode-viewpoint').click();
  await setRangeValue(page.locator('#lm-heading'), 270);
  await expect(page.getByTestId('camera-heading')).toContainText('270° W');
  await page.getByTestId('lens-35').click();
  await expect(page.getByTestId('camera-controls')).toContainText('35 mm');
});

test('light finder: sunset due west from Kailua exists and jumps the planner to it', async ({
  page,
}) => {
  await page.goto('/');
  await pickKailua(page);
  await page.getByTestId('details-light-finder').locator('summary').click();
  await page.getByTestId('finder-mode-manual').click();
  await page.getByTestId('finder-azimuth').fill('270');
  await page.getByTestId('finder-elevation').fill('-0.8');
  // Anonymous visitors search inside the free window (today ± window), which always contains today.
  await page.getByTestId('finder-run').click();
  const results = page.getByTestId('finder-results');
  await expect(results).toBeVisible();
  await expect(results).toContainText(/scanned \d+ days/);
  // The sun sets due west only near the equinoxes; assert the honest outcome either way.
  const text = (await results.textContent()) ?? '';
  const list = page.getByTestId('finder-results-list');
  if (/\b0 moments\b/.test(text)) {
    await expect(list).toContainText('Nothing in this range');
  } else {
    await list.getByRole('button').first().click();
    await expect(page.getByTestId('timeline-time')).toHaveText(/^(17|18|19):\d\d$/);
  }
});

test('sign in (dev), create a project, save the viewpoint, reload and reopen it', async ({
  page,
}) => {
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
  await setDateTime(page, '2026-05-31', 12 * 60 + 30);
  await page.getByRole('button', { name: 'Collapse panel' }).click();
  await expect(page.getByTestId('world-map')).toBeVisible();
  // Collapsed, the sheet still shows the glance line (time · phase · sun · basis) …
  const peek = page.getByTestId('sheet-peek');
  await expect(peek).toBeVisible();
  await expect(peek).toContainText('12:30');
  await expect(peek).toContainText('Daylight');
  // … and tapping it opens the sheet again, as does the handle.
  await peek.click();
  await expect(page.getByTestId('timeline')).toBeVisible();
  await page.getByRole('button', { name: 'Collapse panel' }).click();
  await expect(peek).toBeVisible();
  await page.getByRole('button', { name: 'Expand panel' }).click();
  await expect(page.getByTestId('timeline')).toBeVisible();
});
