import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { isAdminAreaEnabled } from '@/lib/auth/allowlist';
import { verifyResetToken } from '@/lib/auth/reset';
import { ResetForm } from '@/components/admin/ResetForm';

export const metadata: Metadata = {
  title: 'Set a new password — Stayful Admin',
  robots: { index: false, follow: false },
};

// Outside the (protected) route group: whoever lands here is by definition
// signed out.
export const dynamic = 'force-dynamic';

export default async function AdminResetPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  if (!isAdminAreaEnabled()) notFound();

  const { token } = await searchParams;
  // Checked (not consumed) up front, so an expired link says so immediately
  // rather than after the user has typed a new password twice.
  const lookup = token ? await verifyResetToken(token) : null;

  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-50 px-6">
      <div className="w-full max-w-sm">
        <h1 className="text-lg font-semibold text-neutral-900">Set a new password</h1>

        {lookup ? (
          <>
            <p className="mt-1 text-sm text-neutral-500">for {lookup.email}</p>
            <div className="mt-6 rounded-lg border border-neutral-200 bg-white p-6">
              <ResetForm token={token as string} />
            </div>
          </>
        ) : (
          <div className="mt-6 rounded-lg border border-neutral-200 bg-white p-6">
            <p className="text-sm text-neutral-700">
              This reset link has expired or already been used.
            </p>
            <p className="mt-2 text-sm text-neutral-500">
              Reset links last an hour and work once.
            </p>
            <Link
              href="/admin/login"
              className="mt-4 inline-block text-sm text-neutral-900 underline underline-offset-2"
            >
              Request a new one
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
