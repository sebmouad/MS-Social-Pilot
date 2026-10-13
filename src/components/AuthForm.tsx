'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useTranslations } from 'next-intl';

import { afterAuthPath, withInviteParam } from '@/lib/invite-path';

interface Props {
  mode: 'login' | 'register';
  registrationAllowed?: boolean;
  /**
   * An invitation the visitor arrived with.
   *
   * Signing in or registering is a detour on the way to accepting it, so the
   * token has to survive the detour. Without it they land on a dashboard for a
   * workspace they were not invited to, with nothing on screen mentioning the
   * invitation, and have to go back to the email and click the link again.
   */
  inviteToken?: string;
  /** Prefilled from a client invitation: the address it was sent to, and a workspace name. */
  defaults?: { email?: string; workspaceName?: string };
}

export function AuthForm({ mode, inviteToken, defaults, registrationAllowed = true }: Props) {
  const t = useTranslations('auth');
  const tApp = useTranslations('app');
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  /**
   * Whether the submit handler below is actually attached yet.
   *
   * Until React hydrates this component, `onSubmit` does not exist and the
   * browser handles a click itself: a plain GET to the current URL with every
   * field in the query string. That puts the visitor's password in their
   * history, in the Referer header of the next request, and in the server's
   * access log. On a fast connection the window is milliseconds; on a slow
   * phone it is long enough to click.
   *
   * So the button starts disabled and the form is marked POST, and neither the
   * click nor an Enter keypress can submit anything until the handler is there
   * to intercept it.
   */
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);

  const isRegister = mode === 'register';

  // Switching between "sign in" and "create an account" must not drop the
  // invitation either — it is the same detour, one click longer.
  const withInvite = (path: string): string => withInviteParam(path, inviteToken);

  // Ties a field's message to the field, so a screen reader announces it on
  // focus rather than leaving it as loose text further down the form.
  const fieldState = (name: string) =>
    fields[name] ? { 'aria-invalid': true, 'aria-describedby': `${name}-error` } : {};

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setFields({});

    const form = new FormData(event.currentTarget);
    const payload = Object.fromEntries(form.entries());

    let response: Response;
    try {
      response = await fetch(`/api/auth/${mode}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch {
      // A dropped connection rejects rather than answering; without this the
      // button would say "Please wait…" for as long as the tab stays open.
      setError(t('networkError'));
      setPending(false);
      return;
    }

    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        fields?: Record<string, string>;
      };
      setError(body.error ?? t('somethingWrong'));
      setFields(body.fields ?? {});
      setPending(false);
      return;
    }

    // Pending stays on through the navigation: the session exists now, and a
    // second click would only register the same account again.
    // Server components read the session cookie, so refresh before navigating.
    const body = (await response.json().catch(() => ({}))) as { next?: 'verify' | 'enroll' | null };
    router.refresh();
    if (body.next) {
      // Password right, second step to go (or to set up): the invitation waits.
      const step = body.next === 'enroll' ? '/login/two-step/setup' : '/login/two-step';
      router.push(withInviteParam(step, inviteToken));
      return;
    }
    // A new workspace starts with its basics (S3); an invitation goes to the invitation.
    const next = isRegister && !inviteToken ? '/welcome' : afterAuthPath(inviteToken);
    // The consent screen is a full page load, so it renders with the new session.
    if (next.startsWith('/oauth/')) window.location.assign(next);
    else router.push(next);
  }

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-6">
      <div className="mb-8 text-center">
        <h1 className="text-2xl font-semibold text-slate-900">
          {isRegister ? t('createWorkspace') : t('signIn')}
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          {tApp('tagline')}
        </p>
      </div>

      <form onSubmit={onSubmit} method="post" className="card space-y-4 p-6">
        {isRegister && (
          <div>
            <label className="label" htmlFor="name">
              {t('name')}
            </label>
            <input
              id="name"
              name="name"
              className="input"
              required
              autoComplete="name"
              {...fieldState('name')}
            />
            {fields.name && <p id="name-error" className="error-text">{fields.name}</p>}
          </div>
        )}

        <div>
          <label className="label" htmlFor="email">
            {t('email')}
          </label>
          <input
            id="email"
            name="email"
            type="email"
            className="input"
            required
            defaultValue={defaults?.email}
            autoComplete="email"
            {...fieldState('email')}
          />
          {fields.email && <p id="email-error" className="error-text">{fields.email}</p>}
        </div>

        <div>
          <label className="label" htmlFor="password">
            {t('password')}
          </label>
          <input
            id="password"
            name="password"
            type="password"
            className="input"
            required
            autoComplete={isRegister ? 'new-password' : 'current-password'}
            {...fieldState('password')}
          />
          {isRegister && <p className="hint">{t('passwordHint')}</p>}
          {!isRegister && (
            <p className="mt-1 text-end text-xs">
              <Link href="/forgot-password" className="font-medium text-brand-600 hover:underline">
                {t('forgotPassword')}
              </Link>
            </p>
          )}
          {fields.password && <p id="password-error" className="error-text">{fields.password}</p>}
        </div>

        {isRegister && (
          <div>
            <label className="label" htmlFor="workspaceName">
              {t('workspaceName')}{' '}
              <span className="font-normal text-slate-400">{t('optional')}</span>
            </label>
            <input id="workspaceName" name="workspaceName" className="input" placeholder="Acme Marketing" defaultValue={defaults?.workspaceName} />
          </div>
        )}

        {error && (
          <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        <button type="submit" className="btn-primary w-full" disabled={pending || !ready}>
          {pending ? t('pleaseWait') : isRegister ? t('createWorkspace') : t('signIn')}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-slate-600">
        {isRegister ? (
          <>
            {t('haveAccount')}{' '}
            <Link href={withInvite('/login')} className="font-medium text-brand-600 hover:underline">
              {t('signIn')}
            </Link>
          </>
        ) : registrationAllowed ? (
          <>
            {t('noAccount')}{' '}
            <Link href={withInvite('/register')} className="font-medium text-brand-600 hover:underline">
              {t('createOne')}
            </Link>
          </>
        ) : t('registrationClosedBody')}
      </p>
    </div>
  );
}
