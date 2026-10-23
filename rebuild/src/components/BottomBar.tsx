import { IconPlus } from "@tabler/icons-react";
import type { ReactNode } from "react";

export type BottomBarItem = { id: string; href: string; label: string; icon: ReactNode; active?: boolean; badge?: number; badgeLabel?: string };

/**
 * Phone navigation (< 760 px): Plan, Engage, Measure and Grow hubs, a raised Create button, and the
 * Create hub inside the overlay menu. Labels stay visible. The create control is omitted when the
 * member cannot create (read-only roles), leaving the other items evenly spaced.
 */
export function BottomBar({ label, items, create }: { label: string; items: BottomBarItem[]; create?: { href: string; label: string } }) {
  const middle = Math.ceil(items.length / 2);
  const link = (item: BottomBarItem) => <a key={item.id} href={item.href} className={`ui-bottombar__item${item.active ? " is-active" : ""}`} data-hub={item.id} aria-current={item.active ? "page" : undefined} aria-label={item.badge ? item.badgeLabel ?? item.label : undefined}>
    <span className="ui-bottombar__glyph">{item.icon}{item.badge ? <span className="ui-bottombar__badge" aria-hidden="true">{item.badge > 99 ? "99+" : item.badge}</span> : null}</span>
    <span className="ui-bottombar__label">{item.label}</span>
  </a>;
  return <nav className="ui-bottombar" aria-label={label}>
    {items.slice(0, middle).map(link)}
    {create && <a href={create.href} className="ui-bottombar__create" aria-label={create.label}><IconPlus size={26} stroke={2.2} aria-hidden="true" /></a>}
    {items.slice(middle).map(link)}
  </nav>;
}
