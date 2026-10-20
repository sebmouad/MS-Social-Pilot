import type { InputHTMLAttributes, ReactNode, Ref } from 'react';
import styles from './auth.module.css';

/** Shared frame for every signed-out page: brand, one card, one heading. */
export function AuthShell({ title, titleId = 'auth-title', lead, brand = 'Social Pilot', children, footer }: { title: string; titleId?: string; lead?: ReactNode; brand?: string; children?: ReactNode; footer?: ReactNode }) {
  return <main className={styles.page}>
    <a className={styles.brand} href="/sign-in"><span className={styles.brandMark} aria-hidden="true">SP</span>{brand}</a>
    <section className={styles.card} aria-labelledby={titleId}>
      <header className={styles.heading}><h1 id={titleId}>{title}</h1>{lead && <p className={styles.lead}>{lead}</p>}</header>
      <div className={styles.body}>{children}</div>
    </section>
    {footer && <p className={styles.footer}>{footer}</p>}
  </main>;
}

type FieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'className'> & { id: string; label: string; error?: string; hint?: string; trailing?: ReactNode };

/** Labelled input with its hint and error associated for assistive technology. */
export function AuthField({ id, label, error, hint, trailing, ...input }: FieldProps) {
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(' ') || undefined;
  return <div className={styles.field}>
    <label className={styles.label} htmlFor={id}>{label}</label>
    <div className={styles.control}><input id={id} className={styles.input} aria-invalid={error ? true : undefined} aria-describedby={describedBy} {...input} />{trailing}</div>
    {hint && <p id={`${id}-hint`} className={styles.hint}>{hint}</p>}
    {error && <p id={`${id}-error`} className={styles.error}>{error}</p>}
  </div>;
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
