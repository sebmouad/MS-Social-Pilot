'use client';

import { useEffect, useRef, type ReactNode } from 'react';

export function ModalDialog({ children, className, labelledBy, onDismiss, busy = false, initialFocus = '[data-dialog-cancel]' }: {
  children: ReactNode;
  className?: string;
  labelledBy: string;
  onDismiss: () => void;
  busy?: boolean;
  initialFocus?: string;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.showModal();
    const target = dialog.querySelector<HTMLElement>(initialFocus);
    target?.focus();
    return () => {
      if (dialog.open) dialog.close();
      returnFocus?.focus();
    };
  }, [initialFocus]);

  return <dialog ref={dialogRef} className={className} aria-labelledby={labelledBy}
    onCancel={event => { event.preventDefault(); if (!busy) dismissRef.current(); }}
    onMouseDown={event => {
      if (event.target !== event.currentTarget || busy) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dismissRef.current();
    }}>
    {children}
  </dialog>;
}
