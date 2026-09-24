import Link from 'next/link';
import { AccountPanel } from '@/components/AccountMenu';
import { Providers } from '../providers';

export const metadata = { title: 'Account' };

export default async function AccountPage({ searchParams }: { searchParams: Promise<{ checkout?: string }> }) {
  const sp = await searchParams;
  return (
    <main className="mx-auto max-w-lg p-6">
      <Link href="/" className="text-sm text-[var(--lm-text-muted)] hover:text-[var(--lm-text)]">← Back to the map</Link>
      <h1 className="mt-4 text-xl font-semibold">Account</h1>
      {sp.checkout === 'success' ? <p className="mt-2 rounded-[var(--lm-radius-sm)] bg-[color:rgba(88,196,138,0.15)] p-3 text-sm" role="status">Thanks — your subscription is being activated. It usually takes a few seconds for Stripe to confirm.</p> : null}
      {sp.checkout === 'cancelled' ? <p className="mt-2 text-sm text-[var(--lm-text-muted)]">Checkout cancelled. Nothing was charged.</p> : null}
      <div className="mt-6">
        <Providers>
          <AccountPanel />
        </Providers>
      </div>
    </main>
  );
}
