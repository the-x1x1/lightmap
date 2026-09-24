import Link from 'next/link';
import { brand } from '@lightmap/config';
import { SignInPrompt } from '@/components/AccountMenu';
import { Providers } from '../../providers';

export const metadata = { title: 'Sign in' };

export default function SignInPage() {
  return (
    <main className="mx-auto max-w-md p-6">
      <Link href="/" className="text-sm text-[var(--lm-text-muted)] hover:text-[var(--lm-text)]">
        ← Back to the map
      </Link>
      <h1 className="mt-4 text-xl font-semibold">Sign in to {brand.name}</h1>
      <p className="mt-1 text-sm text-[var(--lm-text-muted)]">No password. We email you a link.</p>
      <div className="mt-6">
        <Providers>
          <SignInPrompt />
        </Providers>
      </div>
    </main>
  );
}
