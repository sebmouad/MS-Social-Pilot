"use client";
import { IconX } from "@tabler/icons-react";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { Button } from "./Button";

type SidePanelProps = {
  open: boolean;
  title: string;
  onClose: () => void;
  closeLabel: string;
  children: ReactNode;
  /** Sticky footer actions. */
  actions?: ReactNode;
  className?: string;
};

/**
 * Non-modal 440 px panel for list-item details (a post opened from Content). The list stays usable;
 * Escape closes the panel and returns focus to the element that opened it. A page on phones.
 */
export function SidePanel({ open, title, onClose, closeLabel, children, actions, className = "" }: SidePanelProps) {
  const titleId = useId();
  const panel = useRef<HTMLElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panel.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || document.querySelector("dialog[open]")) return;
      if (!panel.current?.contains(document.activeElement) && document.activeElement !== document.body) return;
      event.preventDefault();
      onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); opener.current?.focus?.(); };
  }, [open, onClose]);
  if (!open) return null;
  return <aside ref={panel} tabIndex={-1} className={`ui-side-panel ${className}`.trim()} aria-labelledby={titleId}>
    <header className="ui-side-panel__head"><h2 id={titleId}>{title}</h2><Button variant="quiet" size="sm" aria-label={closeLabel} onClick={onClose} leading={<IconX size={18} stroke={1.75} />} /></header>
    <div className="ui-side-panel__body">{children}</div>
    {actions && <footer className="ui-side-panel__actions">{actions}</footer>}
  </aside>;
}
