"use client";
import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Menu } from "./Menu";

export type TabItem = { id: string; label: string; icon?: ReactNode; count?: number; disabled?: boolean; content?: ReactNode };

type TabsProps = {
  items: TabItem[];
  /** Controlled selection; omit for uncontrolled with `defaultValue`. */
  value?: string;
  defaultValue?: string;
  onChange?: (id: string) => void;
  label: string;
  className?: string;
};

/** Underline tabs with optional icons and counts. Left/Right, Home and End move and activate; the strip scrolls instead of wrapping. */
export function Tabs({ items, value, defaultValue, onChange, label, className = "" }: TabsProps) {
  const base = useId();
  const [inner, setInner] = useState(defaultValue ?? items.find(item => !item.disabled)?.id ?? "");
  const requested = value ?? inner;
  const current = items.find(item => item.id === requested && !item.disabled)?.id ?? items.find(item => !item.disabled)?.id;
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const select = (id: string) => { if (value === undefined) setInner(id); onChange?.(id); };
  const onKey = (event: KeyboardEvent) => {
    const enabled = items.filter(item => !item.disabled);
    if (!enabled.length) return;
    const index = enabled.findIndex(item => item.id === current);
    let next = -1;
    if (event.key === "ArrowRight") next = (index + 1) % enabled.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + enabled.length) % enabled.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = enabled.length - 1;
    if (next < 0) return;
    event.preventDefault();
    const target = enabled[next]!;
    select(target.id);
    refs.current[target.id]?.focus();
  };
  const active = items.find(item => item.id === current);
  return <div className={`ui-tabs ${className}`.trim()}>
    <div role="tablist" aria-label={label} className="ui-tabs__list" onKeyDown={onKey}>
      {items.map(item => <button key={item.id} ref={node => { refs.current[item.id] = node; }} type="button" role="tab" id={`${base}-tab-${item.id}`} aria-selected={item.id === current} aria-controls={item.id === current && item.content !== undefined ? `${base}-panel-${item.id}` : undefined}
        tabIndex={item.id === current ? 0 : -1} disabled={item.disabled} className="ui-tabs__tab" onClick={() => select(item.id)}>
        {item.icon && <span className="ui-tabs__icon" aria-hidden="true">{item.icon}</span>}
        <span>{item.label}</span>
        {item.count !== undefined && <span className="ui-tabs__count">{item.count}</span>}
      </button>)}
    </div>
    {active?.content !== undefined && <div role="tabpanel" id={`${base}-panel-${active.id}`} aria-labelledby={`${base}-tab-${active.id}`} tabIndex={0} className="ui-tabs__panel">{active.content}</div>}
  </div>;
}

export type LinkTabItem = { id: string; href: string; label: string; icon?: ReactNode; count?: number };

/**
 * Tabs that are URL routes (Primer UnderlineNav): real links with aria-current, never mixed with panel tabs.
 * More than `maxVisible` tabs overflow into a "More" menu; the current tab always stays visible.
 */
export function LinkTabs({ items, activeId, label, maxVisible = 7, moreLabel, className = "" }: { items: LinkTabItem[]; activeId?: string; label: string; maxVisible?: number; moreLabel: string; className?: string }) {
  if (items.length < 2) return null;
  let visible = items.slice(0, maxVisible);
  const active = items.find(item => item.id === activeId);
  if (active && !visible.includes(active) && visible.length) visible = [...visible.slice(0, -1), active];
  const overflow = items.filter(item => !visible.includes(item));
  const link = (item: LinkTabItem) => <a key={item.id} href={item.href} className="ui-tabs__tab ui-tabs__link" aria-current={item.id === activeId ? "page" : undefined}>
    {item.icon && <span className="ui-tabs__icon" aria-hidden="true">{item.icon}</span>}
    <span>{item.label}</span>
    {item.count !== undefined && <span className="ui-tabs__count">{item.count}</span>}
  </a>;
  return <nav className={`ui-tabs ui-tabs--links ${className}`.trim()} aria-label={label}>
    <div className="ui-tabs__list">
      {visible.map(link)}
      {overflow.length > 0 && <Menu label={moreLabel} align="end" className="ui-tabs__more" trigger={<span>{moreLabel}</span>} items={overflow.map(item => ({ key: item.id, label: item.label, onSelect: () => { window.location.assign(item.href); } }))} />}
    </div>
  </nav>;
}
