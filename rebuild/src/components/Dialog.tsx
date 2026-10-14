"use client";
import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import { Button } from "./Button";

export function Dialog({ open, title, description, children, onClose, actions }: { open: boolean; title: string; description?: string; children: ReactNode; onClose: () => void; actions?: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return <dialog ref={ref} className="ui-dialog" aria-labelledby="dialog-title" aria-describedby={description ? "dialog-description" : undefined} onClose={onClose} onCancel={event => { event.preventDefault(); onClose(); }}>
    <div className="ui-dialog__header"><div><h2 id="dialog-title">{title}</h2>{description && <p id="dialog-description">{description}</p>}</div><Button variant="quiet" size="sm" aria-label="Close dialog" onClick={onClose}>Close</Button></div>
    <div className="ui-dialog__body">{children}</div>{actions && <div className="ui-dialog__actions">{actions}</div>}
  </dialog>;
}
