"use client";
import { IconX } from "@tabler/icons-react";
import { useId, type ReactNode } from "react";
import { Button } from "./Button";
import { ModalDialog } from "./ModalDialog";

type DrawerProps = {
  open: boolean;
  title: string;
  description?: string;
  children: ReactNode;
  onClose: () => void;
  /** Sticky footer actions. */
  actions?: ReactNode;
  side?: "end" | "start";
  busy?: boolean;
  closeLabel?: string;
};

/** Side panel for detail and edit work that should keep the list visible. Same focus, Escape and backdrop rules as Dialog; full width on phones. */
export function Drawer({ open, title, description, children, onClose, actions, side = "end", busy = false, closeLabel = "Close" }: DrawerProps) {
  const titleId = useId();
  const descriptionId = useId();
  if (!open) return null;
  return <ModalDialog className={`ui-drawer ui-drawer--${side}`} labelledBy={titleId} describedBy={description ? descriptionId : undefined} onDismiss={onClose} busy={busy} initialFocus="[data-dialog-cancel]">
    <div className="ui-drawer__header">
      <div><h2 id={titleId}>{title}</h2>{description && <p id={descriptionId}>{description}</p>}</div>
      <Button variant="quiet" size="sm" data-dialog-cancel aria-label={closeLabel} disabled={busy} onClick={onClose} leading={<IconX size={18} stroke={1.75} />} />
    </div>
    <div className="ui-drawer__body">{children}</div>
    {actions && <div className="ui-drawer__actions">{actions}</div>}
  </ModalDialog>;
}
