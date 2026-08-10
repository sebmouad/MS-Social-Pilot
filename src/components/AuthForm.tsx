'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

interface Props {
  mode: 'login' | 'register';
}

export function AuthForm({ mode }: Props) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  const isRegister = mode === 'register';

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setFields({});

    const form = new FormData(event.currentTarget);
    const payload = Object.fromEntries(form.entries());

    const response = await fetch(`/api/auth/${mode}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        fields?: Record<string, string>;
      };
      setError(body.error ?? 'Something went wrong.');
      setFields(body.fields ?? {});
      setPending(false);
      return;
    }

    // Server components read the session cookie, so refresh before navigating.
    router.refresh();
    router.push('/dashboard');
  }

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-6">
      <div className="mb-8 text-center">
        <h1 className="text-2xl font-semibold text-slate-900">
          {isRegister ? 'Create your workspace' : 'Sign in'}
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          Schedule Facebook Page and Group posts from one place.
        </p>
      </div>

      <form onSubmit={onSubmit} className="card space-y-4 p-6">
        {isRegister && (
          <div>
            <label className="label" htmlFor="name">
              Your name
            </label>
            <input id="name" name="name" className="input" required autoComplete="name" />
            {fields.name && <p className="error-text">{fields.name}</p>}
          </div>
        )}

        <div>
          <label className="label" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            className="input"
            required
            autoComplete="email"
          />
          {fields.email && <p className="error-text">{fields.email}</p>}
        </div>

        <div>
          <label className="label" htmlFor="password">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            className="input"
            required
            autoComplete={isRegister ? 'new-password' : 'current-password'}
          />
          {isRegister && <p className="hint">At least 10 characters.</p>}
          {fields.password && <p className="error-text">{fields.password}</p>}
        </div>

        {isRegister && (
          <div>
            <label className="label" htmlFor="workspaceName">
              Workspace name <span className="font-normal text-slate-400">(optional)</span>
            </label>
            <input id="workspaceName" name="workspaceName" className="input" placeholder="Acme Marketing" />
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        <button type="submit" className="btn-primary w-full" disabled={pending}>
          {pending ? 'Please wait…' : isRegister ? 'Create workspace' : 'Sign in'}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-slate-600">
        {isRegister ? (
          <>
            Already have an account?{' '}
            <Link href="/login" className="font-medium text-brand-600 hover:underline">
              Sign in
            </Link>
          </>
        ) : (
          <>
            No account yet?{' '}
            <Link href="/register" className="font-medium text-brand-600 hover:underline">
              Create one
            </Link>
          </>
        )}
      </p>
    </div>
  );
}
