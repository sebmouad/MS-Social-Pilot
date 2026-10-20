"use client";
import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

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
  const current = value ?? inner;
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const select = (id: string) => { if (value === undefined) setInner(id); onChange?.(id); };
  const onKey = (event: KeyboardEvent) => {
    const enabled = items.filter(item => !item.disabled);
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
      {items.map(item => <button key={item.id} ref={node => { refs.current[item.id] = node; }} type="button" role="tab" id={`${base}-tab-${item.id}`} aria-selected={item.id === current} aria-controls={`${base}-panel-${item.id}`}
        tabIndex={item.id === current ? 0 : -1} disabled={item.disabled} className="ui-tabs__tab" onClick={() => select(item.id)}>
        {item.icon && <span className="ui-tabs__icon" aria-hidden="true">{item.icon}</span>}
        <span>{item.label}</span>
        {item.count !== undefined && <span className="ui-tabs__count">{item.count}</span>}
      </button>)}
    </div>
    {active?.content !== undefined && <div role="tabpanel" id={`${base}-panel-${active.id}`} aria-labelledby={`${base}-tab-${active.id}`} tabIndex={0} className="ui-tabs__panel">{active.content}</div>}
  </div>;
}
