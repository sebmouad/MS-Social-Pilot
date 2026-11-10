"use client";
import { IconX } from "@tabler/icons-react";
import { useId, type ReactNode } from "react";
import { Button } from "./Button";
import { ModalDialog } from "./ModalDialog";

type SidePanelProps = {
  open: boolean;
  title: string;
  onClose: () => void;
  closeLabel: string;
  children: ReactNode;
  /** Footer actions, pinned under the scrolling body. */
  actions?: ReactNode;
  className?: string;
};

/**
 * Details of a list item (a post, a task, a picture, an ad account), opened from its row. A centered window over
 * the list on wide screens and a bottom sheet on phones; the list behind keeps its place, filters and scroll.
 * Escape, the close button or a click outside closes it and focus returns to the row that opened it.
 * (It used to be a panel beside the list, which squeezed the list's columns; the name is kept for its callers.)
 */
export function SidePanel({ open, title, onClose, closeLabel, children, actions, className = "" }: SidePanelProps) {
  const titleId = useId();
  if (!open) return null;
  return <ModalDialog className={`ui-dialog ui-dialog--detail ${className}`.trim()} labelledBy={titleId} onDismiss={onClose} initialFocus="[data-dialog-cancel]">
    <div className="ui-dialog__header"><h2 id={titleId}>{title}</h2><Button variant="quiet" size="sm" data-dialog-cancel aria-label={closeLabel} onClick={onClose} leading={<IconX size={18} stroke={1.75} />} /></div>
    <div className="ui-dialog__body">{children}</div>
    {actions && <div className="ui-dialog__actions">{actions}</div>}
  </ModalDialog>;
}
