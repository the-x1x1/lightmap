import Link from 'next/link';

export const metadata = { title: 'Sign-in problem' };

export default async function AuthErrorPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const message = error === 'Verification' ? 'That sign-in link has expired or was already used. Request a new one.' : error === 'AccessDenied' ? 'Sign-in was refused for this account.' : 'Sign-in did not complete. Please try again.';
  return (
    <main className="mx-auto max-w-md p-6">
      <h1 className="text-xl font-semibold">Sign-in problem</h1>
      <p className="mt-2 text-sm text-[var(--lm-text-muted)]">{message}</p>
      <Link href="/account/sign-in" className="mt-6 inline-block text-sm underline underline-offset-2">Try again</Link>
    </main>
  );
}
