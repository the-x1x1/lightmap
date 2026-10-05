import { brand } from '@lightmap/config';

export const metadata = { title: 'Terms' };

/**
 * Terms of service — DRAFT for counsel review (plan Phase 3, "privacy policy and terms text").
 * Product statements match PRODUCT_SPEC.md and RENDERING_ACCURACY.md; bracketed items are for the
 * operator/counsel (governing law, entity, liability caps).
 */
const LAST_UPDATED = '2026-10-04';
const support = brand.urls.support.replace(/^mailto:/, '');

export default function TermsPage() {
  return (
    <main className="prose prose-invert mx-auto max-w-2xl p-6">
      <h1>Terms of service</h1>
      <p className="text-sm">
        <strong>Draft — not yet reviewed by counsel.</strong> Last updated {LAST_UPDATED}. These
        terms are between you and [legal entity name] (&ldquo;we&rdquo;), the operator of{' '}
        {brand.name}. Contact: <a href={brand.urls.support}>{support}</a>.
      </p>

      <h2>1. What {brand.name} is</h2>
      <p>
        {brand.name} is a planning tool. It computes where the sun and moon will be for a place,
        date and time, shows weather forecasts and scenarios, and renders a simulated preview of the
        light on the terrain. It helps you decide when and where to stand; it does not take the
        photograph and it is not a navigation, aviation, marine or safety product.
      </p>

      <h2>2. Accuracy — what you can and cannot rely on</h2>
      <ul>
        <li>
          <strong>Sun and moon positions</strong> are computed from published astronomical
          algorithms and checked against reference tables; they are accurate to well under a degree,
          and rise/set times to about a minute at ordinary latitudes. Near the poles, and when the
          sun skims the horizon, times are less precise and the app says so.
        </li>
        <li>
          <strong>Weather</strong> is a third-party forecast where one exists, labelled with its
          source and confidence. Beyond the forecast horizon the app shows a <em>scenario</em> you
          chose, and &ldquo;typical for this month&rdquo; is a climate summary. Neither is a
          forecast and neither is labelled as one.
        </li>
        <li>
          <strong>Previews</strong> are simulations from terrain and map data unless labelled
          &ldquo;Real reference&rdquo;. Terrain-horizon times come from an elevation model that does
          not contain trees, buildings or cloud on a ridge; the app carries that caveat wherever
          those times appear.
        </li>
        <li>
          <strong>Camera figures</strong> (field of view, depth of field, level) follow standard
          optical conventions stated in the app and depend on the sensor and lens you enter.
        </li>
      </ul>
      <p>
        You use the output as a planning aid at your own judgement. Do not rely on it for decisions
        where an error could cause injury, loss or damage — terrain, tides, weather and access on
        the day are yours to check.
      </p>

      <h2>3. Your account</h2>
      <p>
        You can explore without an account. Saving projects requires one; you sign in with a link
        sent to your email or with Google, and you are responsible for keeping that email account
        secure. One account per person; you may not share sign-in links. We may suspend accounts
        that abuse the service (see §6).
      </p>

      <h2>4. Plans, payment and cancellation</h2>
      <ul>
        <li>
          The Free plan has the limits shown in the app (planning window, saved projects and
          viewpoints, preview quality). Paid plans lift those limits as described at checkout.
        </li>
        <li>
          Payments are processed by Stripe under its own terms; we do not see your card details.
          Prices are shown with applicable taxes at checkout. [Counsel: tax and currency wording.]
        </li>
        <li>
          Subscriptions renew automatically at the end of each billing period until cancelled. You
          can cancel at any time from the billing portal in the account panel; access continues to
          the end of the period already paid for, and there is no further charge.
        </li>
        <li>
          If a renewal payment fails, Stripe retries it and the app shows a fix-payment notice; your
          plan keeps working for seven days after the period end. If payment still fails the plan
          returns to Free: your saved projects remain, and features above the Free limits pause
          until the plan is restored.
        </li>
        <li>
          Refunds: [Counsel: policy — e.g. statutory cooling-off where it applies; otherwise no
          partial-period refunds.]
        </li>
        <li>We may change prices for future periods with at least 30 days' notice in the app.</li>
      </ul>

      <h2>5. Your content</h2>
      <p>
        Project names, notes, viewpoints and the places you save are yours. You give us only the
        permission needed to store them, show them back to you, render previews and thumbnails from
        them and keep backups. There are no uploads of photographs and no public sharing in this
        version; nothing you save is visible to other users.
      </p>

      <h2>6. Acceptable use</h2>
      <p>You agree not to:</p>
      <ul>
        <li>
          scrape, bulk-download or redistribute map, terrain, weather or place data obtained through
          the service, or use the API outside the app;
        </li>
        <li>
          circumvent plan limits, rate limits, or the licence terms of the data providers shown in
          the attribution footer;
        </li>
        <li>
          use the service to plan access to places where you have no right to be, or in a way that
          endangers people, wildlife or property;
        </li>
        <li>
          interfere with the service&rsquo;s operation or security, or probe it for vulnerabilities
          other than through the responsible-disclosure contact in our security policy.
        </li>
      </ul>

      <h2>7. Third-party data and attribution</h2>
      <p>
        Terrain, basemaps, weather and place names come from third parties whose names and licences
        are shown in the attribution footer and must not be removed from exported planning cards.
        Their availability is not under our control; when a provider is unavailable the app falls
        back to scenarios or the map overlay and says so.
      </p>

      <h2>8. Intellectual property</h2>
      <p>
        The {brand.name} software, design and documentation are ours or our licensors'. These terms
        give you a personal, non-transferable licence to use the service; they do not transfer any
        ownership. Third-party components are listed with their licences in the app&rsquo;s notices.
      </p>

      <h2>9. Availability and changes</h2>
      <p>
        We work to keep the service available but do not guarantee uninterrupted operation. We may
        change or retire features; if a change removes something a paid plan was sold on, you may
        cancel and we will refund the unused part of the current period.
      </p>

      <h2>10. Ending the agreement</h2>
      <p>
        You can delete your account at any time from the account panel (erasure after a 14-day grace
        period, see the privacy policy). We may suspend or close accounts that breach §6 after
        notice, or immediately where the breach is serious.
      </p>

      <h2>11. Liability</h2>
      <p>
        [Counsel: limitation of liability — the service is provided &ldquo;as is&rdquo; for planning
        purposes; exclude indirect losses; cap direct liability at the fees paid in the preceding 12
        months; carve out what cannot be excluded by law, including death or personal injury caused
        by negligence and fraud.]
      </p>

      <h2>12. Governing law</h2>
      <p>[Counsel: governing law, venue, and consumer-rights carve-outs.]</p>

      <h2>13. Changes to these terms</h2>
      <p>
        We may update these terms. The date at the top changes and signed-in users see a notice in
        the app before material changes take effect; continuing to use the service after that date
        means you accept the new terms.
      </p>
    </main>
  );
}
