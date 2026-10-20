'use client';

import { useState, type FormEvent } from 'react';
import { Button } from '@/components/Button';
import { validateFields } from '@/lib/ui/form-validation';
import { AuthField, AuthNotice, AuthShell, authStyles } from '@/modules/home/auth/AuthShell';
import { authCopy, type AuthLocale } from '@/modules/home/auth/copy';

/** Sign-up page body: the open form, the confirmation, or the closed notice. */
export function SignUpForm({ open, locale = 'en' }: { open: boolean; locale?: AuthLocale }) {
  const copy = authCopy(locale);
  const t = copy.signUp;
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [showPasswords, setShowPasswords] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(null);
    const form = event.currentTarget;
    const fieldErrors = validateFields(form, {
      name: { empty: t.nameEmpty }, email: { empty: t.emailEmpty, invalid: t.emailInvalid },
      password: { empty: t.passwordEmpty }, confirm: { empty: t.confirmEmpty },
    });
    const data = new FormData(form);
    const password = String(data.get('password') ?? '');
    if (!fieldErrors.confirm && !fieldErrors.password && password !== String(data.get('confirm') ?? '')) fieldErrors.confirm = t.mismatch;
    setErrors(fieldErrors);
    if (Object.keys(fieldErrors).length) return;
    setPending(true);
    try {
      const response = await fetch('/api/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, cache: 'no-store',
        body: JSON.stringify({ name: String(data.get('name') ?? ''), email: String(data.get('email') ?? ''), password }) });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) { setError(response.status === 429 ? copy.tooMany : body.error ?? t.failed); return; }
      setDone(true);
    } catch { setError(copy.offline); }
    finally { setPending(false); }
  }

  if (!open) return <AuthShell locale={locale} title={t.closedTitle} lead={t.closedLead}>
    <a className="ui-button ui-button--primary ui-button--md" href="/sign-in"><span>{t.goSignIn}</span></a>
  </AuthShell>;

  if (done) return <AuthShell locale={locale} title={t.doneTitle}>
    <AuthNotice tone="success">{t.done}</AuthNotice>
    <p className={authStyles.links}><a href="/verify-email">{t.resend}</a></p>
  </AuthShell>;

  const toggle = <Button variant="quiet" size="sm" aria-label={showPasswords ? t.hideLabel : t.showLabel} aria-pressed={showPasswords} disabled={pending} onClick={() => setShowPasswords(value => !value)}>{showPasswords ? t.hide : t.show}</Button>;
  return <AuthShell locale={locale} title={t.title} lead={t.lead} footer={<a className={authStyles.linkButton} href="/sign-in">{t.haveAccount}</a>}>
    <form className={authStyles.form} method="post" noValidate onSubmit={submit}>
      <AuthField id="signup-name" name="name" label={t.name} required maxLength={120} autoComplete="name" error={errors.name} disabled={pending} />
      <AuthField id="signup-email" name="email" type="email" label={t.email} required maxLength={320} autoComplete="email" spellCheck={false} error={errors.email} disabled={pending} />
      <AuthField id="signup-password" name="password" type={showPasswords ? 'text' : 'password'} label={t.password} required maxLength={200} autoComplete="new-password" error={errors.password} disabled={pending} trailing={toggle} />
      <AuthField id="signup-confirm" name="confirm" type={showPasswords ? 'text' : 'password'} label={t.confirm} required maxLength={200} autoComplete="new-password" error={errors.confirm} disabled={pending} />
      {error && <AuthNotice>{error}</AuthNotice>}
      <Button type="submit" variant="primary" busy={pending} className={authStyles.fill}>{pending ? t.busy : t.submit}</Button>
    </form>
  </AuthShell>;
}
