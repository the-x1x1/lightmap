import { brand } from '@lightmap/config';

export const metadata = { title: 'Terms' };

/** Placeholder wired into the app (plan Phase 3). Replace with counsel-reviewed terms before launch. */
export default function TermsPage() {
  return (
    <main className="prose prose-invert mx-auto max-w-2xl p-6">
      <h1>Terms of service</h1>
      <p>
        <strong>Placeholder — not yet reviewed by counsel.</strong>
      </p>
      <p>
        {brand.name} is a planning tool. Sun and moon positions are computed from published
        ephemeris algorithms and are accurate to well under a degree. Weather beyond the forecast
        horizon is shown as a labelled scenario, never as a forecast. Previews are simulations
        unless labelled Real Reference; do not rely on them for safety-critical decisions.
      </p>
      <p>
        Subscriptions renew automatically and can be cancelled at any time from the billing portal;
        access continues to the end of the paid period.
      </p>
    </main>
  );
}
