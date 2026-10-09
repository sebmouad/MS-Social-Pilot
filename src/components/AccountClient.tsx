'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

type Locale = 'en' | 'fr';

interface Status {
  kind: 'ok' | 'error';
  text: string;
}

interface Props {
  initial: { name: string; email: string; locale: Locale; otherSessions: number };
  locales: Locale[];
}

/** One status line under a section, so each form reports on itself. */
function StatusLine({ status }: { status: Status | null }) {
  if (!status) return null;
  return (
    <p
      role={status.kind === 'error' ? 'alert' : 'status'}
      className={`text-sm ${status.kind === 'ok' ? 'text-emerald-600' : 'text-red-600'}`}
    >
      {status.text}
    </p>
  );
}

async function send(url: string, method: string, body?: unknown) {
  const response = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).catch(() => null);

  const data = (await response?.json().catch(() => ({}))) as
    | { error?: string; fields?: Record<string, string>; [key: string]: unknown }
    | undefined;
  return { ok: Boolean(response?.ok), data: data ?? {} };
}

export function AccountClient({ initial, locales }: Props) {
  const t = useTranslations('account');
  const tCommon = useTranslations('common');
  const router = useRouter();

  const [name, setName] = useState(initial.name);
  const [locale, setLocale] = useState<Locale>(initial.locale);
  const [profilePending, setProfilePending] = useState(false);
  const [profileStatus, setProfileStatus] = useState<Status | null>(null);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordPending, setPasswordPending] = useState(false);
  const [passwordStatus, setPasswordStatus] = useState<Status | null>(null);

  const [otherSessions, setOtherSessions] = useState(initial.otherSessions);
  const [sessionsPending, setSessionsPending] = useState(false);
  const [sessionsStatus, setSessionsStatus] = useState<Status | null>(null);

  async function saveProfile(event: React.FormEvent) {
    event.preventDefault();
    setProfilePending(true);
    setProfileStatus(null);

    const { ok, data } = await send('/api/account', 'PATCH', { name, locale });
    setProfilePending(false);

    if (!ok) {
      setProfileStatus({ kind: 'error', text: data.error ?? t('failed') });
      return;
    }
    setProfileStatus({ kind: 'ok', text: t('profileSaved') });
    // The language and the name in the header are rendered on the server.
    if (locale !== initial.locale || name.trim() !== initial.name) router.refresh();
  }

  async function savePassword(event: React.FormEvent) {
    event.preventDefault();
    setPasswordStatus(null);

    // Said here rather than by the server, which never sees the confirmation.
    if (newPassword.length < 10) {
      setPasswordStatus({ kind: 'error', text: t('passwordTooShort') });
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordStatus({ kind: 'error', text: t('passwordMismatch') });
      return;
    }

    setPasswordPending(true);
    const { ok, data } = await send('/api/account/password', 'POST', { currentPassword, newPassword });
    setPasswordPending(false);

    if (!ok) {
      const field = data.fields ? Object.values(data.fields)[0] : undefined;
      setPasswordStatus({ kind: 'error', text: field ?? data.error ?? t('failed') });
      return;
    }

    const signedOut = typeof data.signedOut === 'number' ? data.signedOut : 0;
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setOtherSessions(0);
    setPasswordStatus({ kind: 'ok', text: t('passwordChanged', { count: signedOut }) });
  }

  async function signOutOthers() {
    setSessionsPending(true);
    setSessionsStatus(null);

    const { ok, data } = await send('/api/account/sessions', 'DELETE');
    setSessionsPending(false);

    if (!ok) {
      setSessionsStatus({ kind: 'error', text: data.error ?? t('failed') });
      return;
    }
    const signedOut = typeof data.signedOut === 'number' ? data.signedOut : 0;
    setOtherSessions(0);
    setSessionsStatus({ kind: 'ok', text: t('signedOutOthers', { count: signedOut }) });
  }

  return (
    <div className="space-y-6">
      <form className="card p-5" onSubmit={saveProfile}>
        <h2 className="text-sm font-semibold text-slate-900">{t('profile')}</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="accountName">
              {t('name')}
            </label>
            <input
              id="accountName"
              className="input"
              autoComplete="name"
              required
              maxLength={120}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div>
            <label className="label" htmlFor="accountLocale">
              {t('language')}
            </label>
            <select
              id="accountLocale"
              className="input"
              value={locale}
              onChange={(event) => setLocale(event.target.value as Locale)}
            >
              {locales.map((option) => (
                <option key={option} value={option}>
                  {t(`languages.${option}`)}
                </option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="label" htmlFor="accountEmail">
              {t('email')}
            </label>
            <input id="accountEmail" className="input" value={initial.email} readOnly disabled />
            <p className="hint">{t('emailHint')}</p>
          </div>
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button type="submit" className="btn-primary" disabled={profilePending || !name.trim()}>
            {profilePending ? tCommon('working') : tCommon('save')}
          </button>
          <StatusLine status={profileStatus} />
        </div>
      </form>

      <form className="card p-5" onSubmit={savePassword}>
        <h2 className="text-sm font-semibold text-slate-900">{t('password')}</h2>
        <p className="hint">{t('passwordHint')}</p>
        {/* Lets a password manager tie the new password to this account. */}
        <input type="text" name="username" autoComplete="username" value={initial.email} readOnly hidden />
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <div>
            <label className="label" htmlFor="currentPassword">
              {t('currentPassword')}
            </label>
            <input
              id="currentPassword"
              type="password"
              className="input"
              autoComplete="current-password"
              required
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
            />
          </div>
          <div>
            <label className="label" htmlFor="newPassword">
              {t('newPassword')}
            </label>
            <input
              id="newPassword"
              type="password"
              className="input"
              autoComplete="new-password"
              required
              minLength={10}
              maxLength={200}
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
            />
          </div>
          <div>
            <label className="label" htmlFor="confirmPassword">
              {t('confirmPassword')}
            </label>
            <input
              id="confirmPassword"
              type="password"
              className="input"
              autoComplete="new-password"
              required
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
            />
          </div>
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button
            type="submit"
            className="btn-primary"
            disabled={passwordPending || !currentPassword || !newPassword || !confirmPassword}
          >
            {passwordPending ? tCommon('working') : t('changePassword')}
          </button>
          <StatusLine status={passwordStatus} />
        </div>
      </form>

      <section className="card p-5">
        <h2 className="text-sm font-semibold text-slate-900">{t('sessions')}</h2>
        <p className="mt-2 text-sm text-slate-700">{t('sessionsCount', { count: otherSessions })}</p>
        <p className="hint">{t('sessionsHint')}</p>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button
            type="button"
            className="btn-secondary"
            onClick={signOutOthers}
            disabled={sessionsPending || otherSessions === 0}
          >
            {sessionsPending ? tCommon('working') : t('signOutOthers')}
          </button>
          <StatusLine status={sessionsStatus} />
        </div>
      </section>
    </div>
  );
}
