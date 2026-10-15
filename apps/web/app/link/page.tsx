import Link from 'next/link';
import { LinkDevice } from '@/components/LinkDevice';

export const metadata = { title: 'Sign in the desktop app' };

/** Where a desktop app's "Sign in with your browser" lands: approve its code, signing in first. */
export default async function LinkPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string }>;
}) {
  const sp = await searchParams;
  return (
    <main className="mx-auto max-w-lg p-6">
      <Link href="/" className="text-sm text-[var(--lm-text-muted)] hover:text-[var(--lm-text)]">
        ← LightMap
      </Link>
      <h1 className="mt-4 text-xl font-semibold">Sign in the LightMap app</h1>
      <div className="mt-6">
        <LinkDevice code={sp.code ?? ''} />
      </div>
    </main>
  );
}
