'use client';
import type { FormHTMLAttributes, ReactNode } from 'react';

/** A GET filter form that applies as soon as one of its choices changes (no « Apply » click). */
export function AutoSubmitForm({ children, ...props }: FormHTMLAttributes<HTMLFormElement> & { children: ReactNode }) {
  return <form {...props} onChange={event => { if ((event.target as HTMLElement).tagName === 'SELECT') event.currentTarget.requestSubmit(); }}>{children}</form>;
}
