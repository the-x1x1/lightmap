import Link from 'next/link';

export const metadata = { title: 'Check your email' };

export default function CheckEmailPage() {
  return (
    <main className="mx-auto max-w-md p-6">
      <h1 className="text-xl font-semibold">Check your email</h1>
      <p className="mt-2 text-sm text-[var(--lm-text-muted)]">We sent you a sign-in link. It expires in 15 minutes and works once. In development the link is printed to the server log instead.</p>
      <Link href="/" className="mt-6 inline-block text-sm underline underline-offset-2">Back to the map</Link>
    </main>
  );
}
