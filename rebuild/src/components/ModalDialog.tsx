'use client';

import { useEffect, useRef, type ReactNode } from 'react';

export function ModalDialog({ children, className, labelledBy, describedBy, onDismiss, busy = false, initialFocus = '[data-dialog-cancel]' }: {
  children: ReactNode;
  className?: string;
  labelledBy: string;
  describedBy?: string;
  onDismiss: () => void;
  busy?: boolean;
  initialFocus?: string;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const focusSelectorRef = useRef(initialFocus);
  focusSelectorRef.current = initialFocus;
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.showModal();
    const target = dialog.querySelector<HTMLElement>(focusSelectorRef.current);
    target?.focus();
    return () => {
      if (dialog.open) dialog.close();
      returnFocus?.focus();
    };
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog?.open) return;
    const active = document.activeElement;
    if (active instanceof HTMLElement && active !== dialog && dialog.contains(active) && !active.matches(':disabled, [aria-disabled="true"]')) return;
    const preferred = dialog.querySelector<HTMLElement>(initialFocus);
    const target = preferred && !preferred.matches(':disabled, [aria-disabled="true"]') ? preferred : dialog.querySelector<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]');
    target?.focus();
    if (!target || document.activeElement !== target) dialog.focus();
  }, [busy, initialFocus]);

  return <dialog ref={dialogRef} className={className} aria-labelledby={labelledBy} aria-describedby={describedBy} aria-busy={busy}
    onCancel={event => { event.preventDefault(); if (!busy) dismissRef.current(); }}
    onMouseDown={event => {
      if (event.target !== event.currentTarget || busy) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dismissRef.current();
    }}>
    {children}
  </dialog>;
}
