"use client";
import { IconDotsVertical } from "@tabler/icons-react";
import { Popover } from "./Popover";
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

export type MenuItem = {
  key: string;
  label: string;
  icon?: ReactNode;
  /** Shown right-aligned, for example "E". Documentation only; wire the key with useShortcut. */
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
  /** Why the item is unavailable; shown as a tooltip. */
  disabledReason?: string;
  onSelect: () => void;
};

type MenuProps = {
  items: MenuItem[];
  /** Accessible name of the trigger. Required: the default trigger is icon-only. */
  label: string;
  /** Custom trigger content; defaults to a kebab icon. */
  trigger?: ReactNode;
  align?: "start" | "end";
  className?: string;
};

/** Dropdown / kebab menu on the shared Popover (never clipped). Arrow keys move, Home/End jump, Escape closes and returns focus to the trigger. */
export function Menu({ items, label, trigger, align = "end", className = "" }: MenuProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const enabled = () => Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])') ?? []);
  const close = useCallback((restoreFocus: boolean) => { setOpen(false); if (restoreFocus) triggerRef.current?.focus(); }, []);

  useEffect(() => {
    if (open) menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])')?.focus();
  }, [open]);

  const move = (delta: number | "first" | "last") => {
    const list = enabled();
    if (!list.length) return;
    const index = list.indexOf(document.activeElement as HTMLElement);
    const next = delta === "first" ? 0 : delta === "last" ? list.length - 1 : (index + delta + list.length) % list.length;
    list[next]!.focus();
  };

  const onMenuKey = (event: KeyboardEvent) => {
    if (event.key === "ArrowDown") { event.preventDefault(); move(1); }
    else if (event.key === "ArrowUp") { event.preventDefault(); move(-1); }
    else if (event.key === "Home") { event.preventDefault(); move("first"); }
    else if (event.key === "End") { event.preventDefault(); move("last"); }
    else if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(true); }
    else if (event.key === "Tab") setOpen(false);
  };

  return <div className={`ui-menu ${className}`.trim()}>
    <button ref={triggerRef} type="button" className={`ui-menu__trigger${trigger ? "" : " is-icon"}`} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined} aria-label={label}
      onClick={() => setOpen(value => !value)}
      onKeyDown={event => { if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setOpen(true); } }}>
      {trigger ?? <IconDotsVertical size={18} stroke={1.75} aria-hidden="true" />}
    </button>
    <Popover open={open} anchorRef={triggerRef} onClose={close} align={align} className="ui-menu__list" role="menu" id={menuId} label={label} onKeyDown={onMenuKey}>
      <div ref={menuRef} className="ui-menu__items">
        {items.map(item => <button key={item.key} type="button" role="menuitem" tabIndex={-1} aria-disabled={item.disabled || undefined} title={item.disabled ? item.disabledReason : undefined}
          className={`ui-menu__item${item.danger ? " is-danger" : ""}`}
          onClick={() => { if (item.disabled) return; close(true); item.onSelect(); }}>
          {item.icon && <span className="ui-menu__icon" aria-hidden="true">{item.icon}</span>}
          <span className="ui-menu__label">{item.label}</span>
          {item.shortcut && <kbd className="ui-kbd">{item.shortcut}</kbd>}
        </button>)}
      </div>
    </Popover>
  </div>;
}
