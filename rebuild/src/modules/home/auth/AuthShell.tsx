import type { InputHTMLAttributes, ReactNode, Ref } from 'react';
import { Field, TextInput } from '@/components/Forms';
import { ToastProvider } from '@/components/Toast';
import type { AuthLocale } from './copy';
import styles from './auth.module.css';

/** Shared frame for every signed-out page: brand, one card, one heading, and the toast region. */
export function AuthShell({ title, titleId = 'auth-title', lead, brand = 'Social Pilot', children, footer, locale = 'en' }: { title: string; titleId?: string; lead?: ReactNode; brand?: string; children?: ReactNode; footer?: ReactNode; locale?: AuthLocale }) {
  return <ToastProvider dismissLabel={locale === 'fr' ? 'Fermer' : 'Dismiss'}><main className={styles.page}>
    <a className={styles.brand} href="/sign-in"><span className={styles.brandMark} aria-hidden="true">SP</span>{brand}</a>
    <section className={styles.card} aria-labelledby={titleId}>
      <header className={styles.heading}><h1 id={titleId}>{title}</h1>{lead && <p className={styles.lead}>{lead}</p>}</header>
      <div className={styles.body}>{children}</div>
    </section>
    {footer && <p className={styles.footer}>{footer}</p>}
  </main></ToastProvider>;
}

type FieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'className'> & { id: string; label: string; error?: string; hint?: string; trailing?: ReactNode };

/** Labelled input on the shared Field/TextInput; hint and error are associated for assistive technology. */
export function AuthField({ id, label, error, hint, trailing, ...input }: FieldProps) {
  return <Field id={id} label={label} help={hint} error={error}><TextInput {...input} trailing={trailing} className={trailing ? 'ui-input--action' : ''} /></Field>;
}

/** Errors are announced immediately; success and progress politely. */
export function AuthNotice({ tone = 'error', children, noticeRef }: { tone?: 'error' | 'success' | 'info'; children: ReactNode; noticeRef?: Ref<HTMLParagraphElement> }) {
  const toneClass = tone === 'error' ? styles.noticeError : tone === 'success' ? styles.noticeSuccess : styles.noticeInfo;
  return <p ref={noticeRef} tabIndex={noticeRef ? -1 : undefined} role={tone === 'error' ? 'alert' : 'status'} className={`${styles.notice} ${toneClass}`}>{children}</p>;
}

export function AuthStatus({ children }: { children: ReactNode }) {
  return <p className={styles.status} role="status" aria-busy="true"><span className={styles.spinner} aria-hidden="true" />{children}</p>;
}

export const authStyles = styles;
