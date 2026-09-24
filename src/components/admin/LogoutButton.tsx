'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function LogoutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await fetch('/api/admin/auth/logout', { method: 'POST' });
        router.replace('/admin/login');
        router.refresh();
      }}
      className="text-xs text-neutral-500 underline underline-offset-2 hover:text-neutral-900 disabled:opacity-50"
    >
      Sign out
    </button>
  );
}
