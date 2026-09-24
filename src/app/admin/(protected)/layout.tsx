import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin } from '@/lib/auth/guard';
import { LogoutButton } from '@/components/admin/LogoutButton';

// Belt and braces alongside robots.ts — the admin area should never be indexed.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

// Every render checks the session; nothing here may be prerendered.
export const dynamic = 'force-dynamic';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // Redirects to /admin/login when signed out, 404s when the admin area is
  // unconfigured. NOTE: this guards PAGES only — route handlers under
  // /api/admin must call requireAdminApi() themselves.
  const session = await requireAdmin();

  return (
    <div className="min-h-screen bg-neutral-50">
      <header className="border-b border-neutral-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
          <div className="flex items-baseline gap-3">
            <Link href="/admin/bulk" className="text-sm font-semibold text-neutral-900">
              Stayful Admin
            </Link>
            <span className="text-xs text-neutral-500">Bulk analyser</span>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-xs text-neutral-500">{session.email}</span>
            <LogoutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-6 py-8">{children}</main>
    </div>
  );
}
