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
  // The year's sunrise/sunset swing (solstice bounds): arcs on the rose, numbers in the details.
  await expect(overlay.getByTestId('seasonal-sunrise-arc')).toBeAttached();
  await page.getByTestId('details-astronomy').locator('summary').click();
  await expect(page.getByTestId('seasonal-envelope')).toContainText('Sunrise 64°–115°');
  await expect(page.getByTestId('seasonal-envelope')).toContainText('noon 45°–88°');
  // Moon planning: the full Moon of 31 May 2026 rises and sets inside the day — grey markers.
  await expect(
    page.locator('button[title^="Moonrise"], button[title^="Moonset"]').first(),
  ).toBeAttached();
  // The phase calendar from the selected day: the Full Moon of 31 May (08:45 UTC = 30 May HST)
  // has passed, so the next principal phases start with the last quarter (8 June 10:01 UTC —
  // a minute past midnight HST, so either date is accepted) and the new Moon of 14 June HST.
  await page.getByTestId('moon-details').locator('summary').click();
  await expect(page.getByTestId('moon-next-phases')).toContainText(
    /Last quarter [78] Jun · New 14 Jun/,
  );
  // Night planning: at noon the Milky Way line rules the sky out before anything else.
  await expect(page.getByTestId('milky-way')).toHaveAttribute('data-verdict', 'daylight');
  await expect(page.getByTestId('milky-way')).toContainText('Milky Way core:');
  // The dark windows ahead (scanned from the selected day): the full Moon rules the first nights
  // out, so the first window is the evening of 3 June; a click jumps to the core's peak in it.
  const windows = page.getByTestId('milky-way-windows');
  await expect(windows).toContainText(/Dark windows ahead: 3 Jun 21:\d\d–22:\d\d \(core to 2\d°\)/);
  await windows.getByRole('button').first().click();
  await expect(page.getByTestId('date-input')).toHaveValue('2026-06-03');
  await expect(page.getByTestId('timeline-time')).toHaveText('22:10');
  await expect(page.getByTestId('milky-way')).toHaveAttribute('data-verdict', 'visible');
  await setDateTime(page, '2026-05-31', 12 * 60 + 30);
  await expect(page.getByTestId('timeline-time')).toHaveText('12:30');

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
  // The Light stat shows the colour temperature; the phase is its sub-line.
  await expect(page.getByTestId('preview-light-sub')).toContainText('blue hour');
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

test('level & thirds guide: status follows the pitch and the buttons place the horizon', async ({
  page,
}) => {
  await page.goto('/');
  await pickKailua(page);
  await page.getByTestId('camera-mode-viewpoint').click();
  await page.getByTestId('level-guide-toggle').check();
  const status = page.getByTestId('level-status');
  await expect(status).toHaveText('Level through the centre');
  await page.getByTestId('level-low-third').click();
  await expect(status).toHaveText('Level on the low third');
  // Horizon on the low third means the camera looks up.
  const pitch = await page
    .locator('#lm-pitch')
    .evaluate((el) => (el as HTMLInputElement).valueAsNumber);
  expect(pitch).toBeGreaterThan(0);
  await page.getByTestId('level-high-third').click();
  await expect(status).toHaveText('Level on the high third');
  // The lines themselves draw only on the 3D globe (the overlay has no frame to level).
  const map = page.getByTestId('world-map');
  if ((await map.getAttribute('data-renderer-mode')) === '3D') {
    await expect(page.getByTestId('level-line')).toBeAttached();
  }
});

test('light finder: sunset due west from Kailua exists and jumps the planner to it', async ({
  page,
}) => {
  await page.goto('/');
  await pickKailua(page);
  // `:scope > summary`: the finder has a nested <details> (Tolerances) with its own summary.
  await page.getByTestId('details-light-finder').locator(':scope > summary').click();
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
  // Sign in first: dev sign-in finishes with a full page load, which would drop a picked place.
  await page.getByTestId('panel-tab-account').click();
  await page.getByTestId('dev-login-email').fill(`e2e-${Date.now()}@example.com`);
  await page.getByTestId('dev-login-submit').click();
  // Dev sign-in finishes with a full page load; clicking the tab before it lands is lost.
  await expect(page.getByTestId('account-button')).toHaveAttribute('data-signed-in', 'true');
  await page.getByTestId('panel-tab-account').click();
  await expect(page.getByTestId('account-panel')).toBeVisible();
  await page.getByTestId('panel-tab-plan').click();
  await pickKailua(page);
  await setDateTime(page, new Date().toISOString().slice(0, 10), 9 * 60);
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

  // Preferences live in the profile once signed in: wipe the device copy and they come back
  // from the account (GET /api/account/profile) on the next load.
  await page.getByTestId('panel-tab-account').click();
  await page.getByTestId('pref-units-imperial').click();
  await expect(page.getByTestId('preferences')).toContainText('Saved to your account.');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByTestId('panel-tab-account').click();
  await expect(page.getByTestId('pref-units-imperial')).toHaveAttribute('aria-checked', 'true');
  await page.getByTestId('pref-units-metric').click();
  await expect(page.getByTestId('pref-units-metric')).toHaveAttribute('aria-checked', 'true');
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

test('mobile: "Point with phone" follows synthetic orientation readings and stops on manual input', async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, 'mobile project only');
  await page.goto('/');
  await pickKailua(page);
  await page.getByTestId('camera-mode-viewpoint').click();
  await page.getByTestId('compass-toggle').click();
  await expect(page.getByTestId('compass-toggle')).toHaveText('Stop following phone');
  // An upright phone whose back camera points west: W3C alpha 90, beta 90 (absolute).
  const fire = (alpha: number, beta: number) =>
    page.evaluate(
      ([a, b]) => {
        const e = new Event('deviceorientationabsolute') as Event & Record<string, unknown>;
        Object.assign(e, { alpha: a, beta: b, gamma: 0, absolute: true });
        window.dispatchEvent(e);
      },
      [alpha, beta] as const,
    );
  await fire(90, 90);
  await expect(page.getByTestId('camera-heading')).toContainText('270° W');
  await expect(page.getByTestId('compass-status')).toContainText('Following the phone');
  // Readings are smoothed and throttled: a quarter turn to the south arrives over a few samples.
  for (let i = 0; i < 12; i++) {
    await page.waitForTimeout(100);
    await fire(180, 90);
  }
  await expect(page.getByTestId('camera-heading')).toContainText(/^(17[5-9]|18[0-5])° S/);
  // The heading slider is manual input: the follow ends.
  await setRangeValue(page.locator('#lm-heading'), 90);
  await expect(page.getByTestId('compass-toggle')).toHaveText('Point with phone');
  await expect(page.getByTestId('camera-heading')).toContainText('90° E');
});

test('mobile: the field view shows the planned sun over the (fake) camera and follows the phone', async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, 'mobile project only');
  await page.goto('/');
  await pickKailua(page);
  // 31 May 2026 17:30 HST: the sun is ~30° up in the west-north-west.
  await setDateTime(page, '2026-05-31', 17 * 60 + 30);
  await page.getByTestId('camera-mode-viewpoint').click();
  await page.getByTestId('field-view-open').click();
  const view = page.getByTestId('field-view');
  await expect(view).toBeVisible();
  await expect(page.getByTestId('field-view-time')).toContainText('17:30');
  // Aim the phone at the sun: heading ≈ 285° (alpha = 360 − 285), tilted back 30° (beta = 120).
  const fire = (alpha: number, beta: number) =>
    page.evaluate(
      ([a, b]) => {
        const e = new Event('deviceorientationabsolute') as Event & Record<string, unknown>;
        Object.assign(e, { alpha: a, beta: b, gamma: 0, absolute: true });
        window.dispatchEvent(e);
      },
      [alpha, beta] as const,
    );
  for (let i = 0; i < 8; i++) {
    await fire(75, 120);
    await page.waitForTimeout(100);
  }
  await expect(page.getByTestId('field-view-sun')).toBeAttached();
  await expect(page.getByTestId('field-view-sun-edge')).toHaveCount(0);
  // Turn away to the south-east: the sun leaves the frame and the edge arrow says how far.
  for (let i = 0; i < 8; i++) {
    await fire(225, 120);
    await page.waitForTimeout(100);
  }
  await expect(page.getByTestId('field-view-sun-edge')).toBeVisible();
  await expect(page.getByTestId('field-view-sun-edge')).toContainText(/sun \d+° (right|left)/);
  await page.getByTestId('field-view-close').click();
  await expect(view).toHaveCount(0);
});

test.describe('preferences', () => {
  // A fixed device zone so "my device's" time is predictable: Kailua 12:30 HST = 23:30 BST.
  test.use({ timezoneId: 'Europe/London' });

  test('times follow the chosen zone, distances the chosen units, and both survive a reload', async ({
    page,
  }) => {
    await page.goto('/');
    await pickKailua(page);
    await setDateTime(page, '2026-05-31', 12 * 60 + 30);
    await expect(page.getByTestId('timeline-time')).toHaveText('12:30');
    await expect(page.getByTestId('date-control')).toContainText('Pacific/Honolulu');

    await page.getByTestId('panel-tab-account').click();
    await expect(page.getByTestId('preferences')).toBeVisible();
    await page.getByTestId('pref-zone-device').click();
    await expect(page.getByTestId('pref-zone-device')).toHaveAttribute('aria-checked', 'true');
    await page.getByTestId('pref-units-imperial').click();
    await page.getByTestId('panel-tab-plan').click();
    // The same instant, read on a London watch (the date rolls with it).
    await expect(page.getByTestId('timeline-time')).toHaveText('23:30');
    await expect(page.getByTestId('date-control')).toContainText('Europe/London');
    // Imperial wind and visibility on a forecast day (the fixture carries both).
    const soon = new Date();
    soon.setDate(soon.getDate() + 2);
    await setDateTime(page, soon.toISOString().slice(0, 10), 14 * 60);
    await page.getByTestId('details-weather').locator('summary').click();
    const weather = page.getByTestId('weather-details');
    await expect(weather).toContainText(/\d+ mph/);
    await expect(weather).not.toContainText('m/s');

    // Kept on this device: the choice is still there after a reload.
    await page.reload();
    await page.getByTestId('panel-tab-account').click();
    await expect(page.getByTestId('pref-zone-device')).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('pref-units-imperial')).toHaveAttribute('aria-checked', 'true');
    await page.getByTestId('pref-zone-location').click();
    await page.getByTestId('pref-units-metric').click();
    await page.getByTestId('panel-tab-plan').click();
    await pickKailua(page);
    await expect(page.getByTestId('date-control')).toContainText('Pacific/Honolulu');
  });
});
