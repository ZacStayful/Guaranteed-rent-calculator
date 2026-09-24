import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { isAdminAreaEnabled } from '@/lib/auth/allowlist';
import { getAdminSession } from '@/lib/auth/guard';
import { LoginForm } from '@/components/admin/LoginForm';

export const metadata: Metadata = {
  title: 'Sign in — Stayful Admin',
  robots: { index: false, follow: false },
};

// Deliberately OUTSIDE the (protected) route group: it must not inherit the
// layout that requires a session, or signing in would redirect-loop.
export const dynamic = 'force-dynamic';

export default async function AdminLoginPage() {
  if (!isAdminAreaEnabled()) notFound();

  // Already signed in — go straight through.
  const session = await getAdminSession();
  if (session) redirect('/admin/bulk');

  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-50 px-6">
      <div className="w-full max-w-sm">
        <h1 className="text-lg font-semibold text-neutral-900">Stayful Admin</h1>
        <p className="mt-1 text-sm text-neutral-500">Sign in to run a bulk analysis.</p>
        <div className="mt-6 rounded-lg border border-neutral-200 bg-white p-6">
          <LoginForm />
        </div>
      </div>
    </div>
  );
}
