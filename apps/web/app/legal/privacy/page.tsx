import { brand } from '@lightmap/config';

export const metadata = { title: 'Privacy' };

/**
 * Privacy policy — DRAFT for counsel review (plan Phase 3, "privacy policy and terms text").
 * Every statement here describes what the code does; docs/PRIVACY.md is the engineering source and
 * must stay in step with this page. Bracketed items are for the operator/counsel to fill in.
 */
const LAST_UPDATED = '2026-10-04';
const support = brand.urls.support.replace(/^mailto:/, '');

export default function PrivacyPage() {
  return (
    <main className="prose prose-invert mx-auto max-w-2xl p-6">
      <h1>Privacy policy</h1>
      <p className="text-sm">
        <strong>Draft — not yet reviewed by counsel.</strong> Last updated {LAST_UPDATED}. Operator:
        [legal entity name and address]. Contact: <a href={brand.urls.support}>{support}</a>.
      </p>
      <p>
        {brand.name} is a planning tool for natural light. It handles location searches, and
        location history is sensitive, so the design principle is simple:{' '}
        <strong>
          what you explore stays on your device; we store a place only when you save it.
        </strong>{' '}
        This page says what we collect, why, where it goes and how to remove it.
      </p>

      <h2>1. What stays on your device</h2>
      <ul>
        <li>
          The place, date, time, weather scenario and camera you are looking at live in your
          browser. Sun and moon positions are computed in the browser; no coordinate is needed on
          our servers for that.
        </li>
        <li>
          Your device's location is used only when you press the location button and your browser
          grants permission. It is never requested on page load, and it is treated like any other
          pin: local until you save it.
        </li>
        <li>
          The field view shows your phone&rsquo;s camera behind the planned sun. The picture is
          drawn on the screen only: nothing is captured, stored or sent, and the camera is released
          when you close the view.
        </li>
        <li>
          Your preferences (units, which time zone times are shown in, the lens a new place starts
          with) are kept in your browser&rsquo;s local storage so they are there on your next visit.
          Signed in, the same three settings are saved to your account so your other devices follow
          them.
        </li>
        <li>
          In production an offline cache on your device keeps a copy of the app and of{' '}
          <em>your own</em> saved projects so they open without a connection. Nothing is sent
          anywhere by it, and it is deleted when you sign out, when you request account deletion,
          when your session ends, or when a different account signs in on the same browser.
        </li>
      </ul>

      <h2>2. What we process while you explore (without an account)</h2>
      <p>
        Two requests leave your browser while you explore, and neither is tied to an account,
        session or device identifier in our storage:
      </p>
      <ul>
        <li>
          <strong>Weather</strong>: our server asks the weather provider for the forecast of the map
          cell you are looking at, with coordinates rounded to a grid of about 5 km (0.05°), never
          the exact pin. The provider sees our server's address, not yours.
        </li>
        <li>
          <strong>Place names</strong>: the text you type in the search box is sent to a geocoding
          service to find matching places; reverse lookups (a label for a map click) use a cell of
          about 1 km (0.01°).
        </li>
      </ul>
      <p>
        To protect the service from abuse we count requests per client using a one-way hash of your
        network address and browser string. The raw address is not stored.
      </p>

      <h2>3. What we store when you have an account</h2>
      <ul>
        <li>
          <strong>Account</strong>: your email address (used to sign you in by magic link, or the
          email from your Google account if you sign in with Google), session records and the time
          you created the account.
        </li>
        <li>
          <strong>Projects and viewpoints</strong>: when you press save, the viewpoint's latitude,
          longitude, elevation, time zone, camera settings and chosen instant are stored, together
          with the project's name, notes and shoot date, and a thumbnail rendered from map and
          terrain data. Notes are freeform; they are shown only to you.
        </li>
        <li>
          <strong>Subscription</strong>: if you subscribe, your plan, its status and the identifiers
          our payment processor assigns. We never see or store card numbers.
        </li>
        <li>
          <strong>Usage counters</strong>: daily totals of API use per account, to enforce plan
          limits and fair use.
        </li>
        <li>
          <strong>Preferences</strong>: units, time-zone mode and default lens, if you change them.
        </li>
      </ul>
      <p>
        There are no photo uploads. No image of yours ever reaches {brand.name} or any third party
        through it.
      </p>

      <h2>4. Analytics and logs</h2>
      <p>
        Product analytics, when enabled, record a small fixed set of events (for example "a place
        was selected", "a viewpoint was saved"). Coordinates in those events are quantised to whole
        degrees (about 110 km); search text, notes, names, email addresses and labels are stripped
        before an event is recorded, and no event carries an account identifier. Events are sent
        only to {brand.name}'s own servers — there is no third-party analytics script — and are not
        sent at all when your browser signals Do Not Track or Global Privacy Control. Server logs
        record the route, status and latency of requests with secrets, tokens, cookies and email
        addresses redacted at write time; they do not record query strings containing coordinates.
      </p>

      <h2>5. Who receives data</h2>
      <table>
        <thead>
          <tr>
            <th>Recipient</th>
            <th>What</th>
            <th>What is not sent</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Weather provider ([provider name])</td>
            <td>Coordinates rounded to a ~5 km cell, date range, requested fields</td>
            <td>Your identity, exact pin, your network address</td>
          </tr>
          <tr>
            <td>Geocoder ([provider name])</td>
            <td>Your search text; ~1 km cells for reverse lookups</td>
            <td>Your identity</td>
          </tr>
          <tr>
            <td>Terrain and basemap tile hosts</td>
            <td>Tile requests from your browser, as with any web map</td>
            <td>Anything beyond the tiles being viewed</td>
          </tr>
          <tr>
            <td>Payment processor (Stripe)</td>
            <td>
              Email address, an account reference, payment details you enter on Stripe's pages
            </td>
            <td>Locations, projects, notes</td>
          </tr>
          <tr>
            <td>Email provider (magic links)</td>
            <td>Email address and the sign-in link</td>
            <td>Anything else</td>
          </tr>
          <tr>
            <td>Error monitoring (when enabled)</td>
            <td>Error messages and stack traces with context redacted</td>
            <td>Coordinates, freeform text</td>
          </tr>
        </tbody>
      </table>
      <p>We do not sell personal data and we do not share it for advertising.</p>

      <h2>6. Cookies</h2>
      <p>
        Only session and security cookies, set when you sign in. No advertising or cross-site
        tracking cookies. Small conveniences such as a collapsed panel may be remembered in your
        browser's local storage; they never contain coordinates.
      </p>

      <h2>7. How long we keep things</h2>
      <ul>
        <li>What you explore without saving: your browser only; gone on reload unless saved.</li>
        <li>Projects, viewpoints, thumbnails: until you delete them or your account is erased.</li>
        <li>Sessions and sign-in links: until they expire or you sign out.</li>
        <li>Subscription records: for the life of the account; erased with it.</li>
        <li>
          Payment webhook records: kept for dispute resolution; they contain processor identifiers,
          not names or coordinates. [Counsel: confirm retention period.]
        </li>
        <li>Usage counters: hashed keys only; may be deleted after 90 days.</li>
        <li>Audit records: kept without personal data.</li>
      </ul>

      <h2>8. Deleting your account</h2>
      <p>
        Request deletion from the account panel. Your account and everything in it — projects,
        viewpoints, thumbnails, sessions and subscription records — are erased 14 days later.
        Signing in during those 14 days cancels the request, so an accidental deletion is
        reversible. Our payment processor keeps its own records of past payments under its terms;
        cancel any active subscription from the billing portal first.
      </p>

      <h2>9. Your rights</h2>
      <p>
        You can see and change your projects at any time in the app, export planning cards, and
        delete your account as above. For a copy of the data we hold about you, to correct it, or
        for any other request, email <a href={brand.urls.support}>{support}</a>. [Counsel: rights
        and timelines under the applicable laws, and the supervisory-authority contact where
        required.]
      </p>

      <h2>10. Children</h2>
      <p>
        {brand.name} is not directed at children under 16 and we do not knowingly collect their
        data. [Counsel: confirm the age threshold for the operating jurisdictions.]
      </p>

      <h2>11. Changes</h2>
      <p>
        When this policy changes we update the date at the top and, for material changes, tell
        signed-in users in the app before the change takes effect.
      </p>
    </main>
  );
}
