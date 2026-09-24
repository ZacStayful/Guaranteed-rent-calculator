'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

const MIN_LENGTH = 12;

export function ResetForm({ token }: { token: string }) {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  // Shown by default here: you're choosing a password, not typing a secret in
  // public, and mistyping one you then can't read back is the whole problem.
  const [show, setShow] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const tooShort = password.length > 0 && password.length < MIN_LENGTH;
  const mismatch = confirm.length > 0 && password !== confirm;

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (password.length < MIN_LENGTH) {
      setError(`Use at least ${MIN_LENGTH} characters.`);
      return;
    }
    if (password !== confirm) {
      setError('The two passwords do not match.');
      return;
    }

    setBusy(true);
    try {
      const res = await fetch('/api/admin/auth/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? 'Could not set the password.');
        return;
      }
      // The reset route signs you in, so go straight through.
      router.replace('/admin/bulk');
      router.refresh();
    } catch {
      setError('Could not reach the server. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <div className="flex items-baseline justify-between">
          <label htmlFor="new-password" className="block text-xs font-medium text-neutral-700">
            New password
          </label>
          <button
            type="button"
            onClick={() => setShow((v) => !v)}
            tabIndex={-1}
            aria-pressed={show}
            className="text-xs text-neutral-500 hover:text-neutral-900"
          >
            {show ? 'Hide' : 'Show'}
          </button>
        </div>
        <input
          id="new-password"
          type={show ? 'text' : 'password'}
          required
          autoFocus
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900"
        />
        <p className={`mt-1 text-xs ${tooShort ? 'text-red-600' : 'text-neutral-500'}`}>
          At least {MIN_LENGTH} characters.
        </p>
      </div>

      <div>
        <label htmlFor="confirm-password" className="block text-xs font-medium text-neutral-700">
          Confirm
        </label>
        <input
          id="confirm-password"
          type={show ? 'text' : 'password'}
          required
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900"
        />
        {mismatch && <p className="mt-1 text-xs text-red-600">These do not match.</p>}
      </div>

      {error && (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={busy || password.length < MIN_LENGTH || password !== confirm}
        className="w-full rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-40"
      >
        {busy ? 'Saving…' : 'Set password and sign in'}
      </button>
    </form>
  );
}
