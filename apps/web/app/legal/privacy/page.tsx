import { brand } from '@lightmap/config';

export const metadata = { title: 'Privacy' };

/** Placeholder wired into the app (plan Phase 3). Replace with counsel-reviewed text before launch; docs/PRIVACY.md is the engineering behaviour. */
export default function PrivacyPage() {
  return (
    <main className="prose prose-invert mx-auto max-w-2xl p-6">
      <h1>Privacy</h1>
      <p><strong>Placeholder — not yet reviewed by counsel.</strong> The engineering behaviour this text will describe is documented in the repository (docs/PRIVACY.md).</p>
      <h2>What {brand.name} stores</h2>
      <ul>
        <li>Locations you explore on the map stay in your browser and are not sent to our servers except to look up a place name, time zone and forecast for that coordinate.</li>
        <li>Coordinates are stored on our servers only when you save a viewpoint to a project.</li>
        <li>Your current-device location is used only when you tap the location button and grant permission.</li>
        <li>Product analytics never include precise coordinates, project notes or search text.</li>
      </ul>
      <h2>Deleting your account</h2>
      <p>Request deletion from the account panel. Your data is erased 14 days later; signing in before then cancels the request.</p>
    </main>
  );
}
