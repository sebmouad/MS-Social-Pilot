'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { collectFormErrors } from '@/lib/ui/form-validation';
export { collectFormErrors } from '@/lib/ui/form-validation';

type Errors = Record<string, string>;
type Control = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

/** Shared associations and first-invalid focus; callers own field names and domain rules. */
export function useFormValidation() {
  const prefix = useId();
  const [errors, setErrors] = useState<Errors>({});
  const focus = useRef<{ form: HTMLFormElement; name: string } | null>(null);
  useEffect(() => {
    const pending = focus.current;
    focus.current = null;
    if (!pending) return;
    const field = Array.from(pending.form.elements).find(element => (element as Control).name === pending.name) as Control | undefined;
    if (field && !field.disabled) { field.focus(); field.scrollIntoView?.({ block: 'nearest' }); }
  }, [errors]);
  function validate(form: HTMLFormElement, customErrors: Errors = {}) {
    const next = collectFormErrors(form, customErrors);
    const invalidNames = Object.keys(next);
    const first = Array.from(form.elements).map(element => (element as Control).name).find(name => next[name]) ?? invalidNames[0];
    focus.current = first ? { form, name: first } : null;
    setErrors(next);
    return invalidNames.length === 0;
  }
  const fieldId = (name: string) => `${prefix}-${name}`;
  return {
    errors,
    validate,
    fieldProps: (name: string, describedBy?: string) => ({ id: fieldId(name), 'aria-invalid': errors[name] ? true as const : undefined, 'aria-describedby': [describedBy, errors[name] ? `${fieldId(name)}-error` : null].filter(Boolean).join(' ') || undefined }),
    errorProps: (name: string) => ({ id: `${fieldId(name)}-error`, children: errors[name] }),
    clear: (name: string) => setErrors(current => { const next = { ...current }; delete next[name]; return next; }),
    clearAll: () => { focus.current = null; setErrors({}); },
  };
}

export function FieldError({ id, children }: { id: string; children?: ReactNode }) {
  return children ? <span id={id} className="ui-field-error" role="alert">{children}</span> : null;
}
