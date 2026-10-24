'use client';

import { FormEvent, useState } from 'react';
import { Button } from '@/components/Button';
import { validateFields } from '@/lib/ui/form-validation';
import { AuthField, AuthNotice, AuthShell, authStyles } from '@/modules/home/auth/AuthShell';
import { authCopy, type AuthLocale } from '@/modules/home/auth/copy';

export default function EnrollSecondStepPage({ continuePath, locale = 'en' }: { continuePath: '/join' | '/home'; locale?: AuthLocale }) {
  const t = authCopy(locale).enroll;
  const [secret, setSecret] = useState('');
  const [codes, setCodes] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [fieldError, setFieldError] = useState('');
  async function begin() {
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/auth/two-step/enroll', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'begin' }) });
      const result = await response.json();
      if (!response.ok) throw new Error();
      setSecret(result.secret);
    } catch { setError(t.beginFailed); }
    finally { setBusy(false); }
  }
  async function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError('');
    const errors = validateFields(event.currentTarget, { code: { empty: t.codeEmpty, invalid: t.codeInvalid } });
    setFieldError(errors.code ?? '');
    if (errors.code) return;
    setBusy(true);
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch('/api/auth/two-step/enroll', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'confirm', code: form.get('code') }) });
      const result = await response.json();
      if (!response.ok) throw new Error();
      setCodes(result.recoveryCodes);
      setSecret('');
    } catch { setError(t.rejected); }
    finally { setBusy(false); }
  }
  if (codes.length) return <AuthShell locale={locale} title={t.savedTitle} lead={t.savedLead}>
    <ul className={authStyles.codes} aria-label={t.savedTitle}>{codes.map(code => <li key={code}><code>{code}</code></li>)}</ul>
    <a className="ui-button ui-button--primary" href={continuePath}>{t.continue}</a>
  </AuthShell>;
  return <AuthShell locale={locale} title={t.title} lead={secret ? t.secretLead : t.intro}>
    {secret ? <>
      <p className={authStyles.secret} aria-label={t.secretLabel}><code>{secret}</code></p>
      <form className={authStyles.form} method="post" noValidate onSubmit={confirm}>
        <AuthField id="setup-code" name="code" label={t.code} autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" required minLength={6} maxLength={6} spellCheck={false} error={fieldError} disabled={busy} />
        {error && <AuthNotice>{error}</AuthNotice>}
        <Button type="submit" variant="primary" busy={busy} className={authStyles.fill}>{busy ? t.busy : t.submit}</Button>
      </form>
    </> : <>
      {error && <AuthNotice>{error}</AuthNotice>}
      <Button variant="primary" busy={busy} onClick={begin} className={authStyles.fill}>{busy ? t.beginBusy : t.begin}</Button>
    </>}
  </AuthShell>;
}
