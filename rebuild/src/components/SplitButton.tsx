"use client";
import { IconChevronDown } from "@tabler/icons-react";
import type { ReactNode } from "react";
import { Button } from "./Button";
import { Menu, type MenuItem } from "./Menu";

type SplitButtonProps = {
  /** Primary action label, for example "Schedule". */
  label: string;
  onClick: () => void;
  /** Related actions, for example Publish now, Add to queue, Schedule…. */
  items: MenuItem[];
  /** Accessible name of the arrow, for example "More ways to publish". */
  menuLabel: string;
  leading?: ReactNode;
  variant?: "primary" | "secondary";
  disabled?: boolean;
  busy?: boolean;
  type?: "button" | "submit";
};

/** A primary action with a menu of related actions beside it; the menu opens through the shared Popover. */
export function SplitButton({ label, onClick, items, menuLabel, leading, variant = "primary", disabled = false, busy = false, type = "button" }: SplitButtonProps) {
  return <span className={`ui-split ui-split--${variant}`}>
    <Button variant={variant} type={type} onClick={onClick} leading={leading} disabled={disabled} busy={busy} className="ui-split__main">{label}</Button>
    <Menu label={menuLabel} items={items} trigger={<IconChevronDown size={16} stroke={2} aria-hidden="true" />} className="ui-split__menu" />
  </span>;
}
