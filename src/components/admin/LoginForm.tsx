'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onForgot() {
    setError(null);
    setNotice(null);
    if (!email) {
      setError('Enter your email address first, then click Forgot password.');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/admin/auth/forgot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const json = await res.json().catch(() => ({}));
      // The endpoint answers identically whether or not the address is an
      // admin, so it can't be used to discover who has access. Echo that.
      setNotice(json.message ?? 'If that address has an admin account, a reset link is on its way.');
    } catch {
      setError('Could not reach the server. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? 'Sign in failed.');
        return;
      }
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
        <label htmlFor="email" className="block text-xs font-medium text-neutral-700">
          Email
        </label>
        <input
          id="email"
          type="email"
          required
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900"
        />
      </div>
      <div>
        <label htmlFor="password" className="block text-xs font-medium text-neutral-700">
          Password
        </label>
        <div className="relative mt-1">
          <input
            id="password"
            // Toggling to a plain text input is what lets the value be read
            // back; there is no way to reveal a type="password" field.
            type={showPassword ? 'text' : 'password'}
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-md border border-neutral-300 py-2 pl-3 pr-16 text-sm outline-none focus:border-neutral-900"
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            // Keeps the toggle out of the tab order between the field and the
            // submit button, and off screen readers announcing it as an action
            // on the form itself.
            tabIndex={-1}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            aria-pressed={showPassword}
            className="absolute inset-y-0 right-0 px-3 text-xs font-medium text-neutral-500 hover:text-neutral-900"
          >
            {showPassword ? 'Hide' : 'Show'}
          </button>
        </div>
      </div>
      {error && (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="rounded-md bg-neutral-100 px-3 py-2 text-xs text-neutral-700">
          {notice}
        </p>
      )}
      <button
        type="submit"
        disabled={busy}
        className="w-full rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
      >
        {busy ? 'Signing in…' : 'Sign in'}
      </button>

      <button
        type="button"
        disabled={busy}
        onClick={onForgot}
        className="w-full text-center text-xs text-neutral-500 underline underline-offset-2 hover:text-neutral-900 disabled:opacity-50"
      >
        Forgot password?
      </button>
    </form>
  );
}
