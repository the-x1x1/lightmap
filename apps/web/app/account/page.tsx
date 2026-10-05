import Link from 'next/link';
import { AccountPanel } from '@/components/AccountMenu';
import { CheckoutReturn } from '@/components/CheckoutReturn';
import { Providers } from '../providers';

export const metadata = { title: 'Account' };

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ checkout?: string }>;
}) {
  const sp = await searchParams;
  return (
    <main className="mx-auto max-w-lg p-6">
      <Link href="/" className="text-sm text-[var(--lm-text-muted)] hover:text-[var(--lm-text)]">
        ← Back to the map
      </Link>
      <h1 className="mt-4 text-xl font-semibold">Account</h1>
      <div className="mt-6">
        <Providers>
          {sp.checkout === 'success' || sp.checkout === 'cancelled' ? (
            <CheckoutReturn outcome={sp.checkout} />
          ) : null}
          <AccountPanel />
        </Providers>
      </div>
    </main>
  );
}
