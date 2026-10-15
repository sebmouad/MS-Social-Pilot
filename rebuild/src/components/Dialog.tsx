"use client";
import { useId, type ReactNode } from "react";
import { Button } from "./Button";
import { ModalDialog } from "./ModalDialog";

export function Dialog({ open, title, description, children, onClose, actions }: { open: boolean; title: string; description?: string; children: ReactNode; onClose: () => void; actions?: ReactNode }) {
  const titleId = useId();
  const descriptionId = useId();
  if (!open) return null;
  return <ModalDialog className="ui-dialog" labelledBy={titleId} describedBy={description ? descriptionId : undefined} onDismiss={onClose} initialFocus="[data-dialog-cancel]">
    <div className="ui-dialog__header"><div><h2 id={titleId}>{title}</h2>{description && <p id={descriptionId}>{description}</p>}</div><Button variant="quiet" size="sm" data-dialog-cancel aria-label="Close dialog" onClick={onClose}>Close</Button></div>
    <div className="ui-dialog__body">{children}</div>{actions && <div className="ui-dialog__actions">{actions}</div>}
  </ModalDialog>;
}
