"use client";
import { IconCheck, IconChevronDown, IconSearch } from "@tabler/icons-react";
import { usePopupPlacement } from "./usePopupPlacement";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

export type SelectOption = { value: string; label: string; icon?: ReactNode; description?: string; disabled?: boolean };

type SelectProps = {
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  /** Accessible name when no visible <label htmlFor={id}> exists. */
  "aria-label"?: string;
  id?: string;
  /** Renders a hidden input so the value posts with a native form. */
  name?: string;
  placeholder?: string;
  /** Adds a filter box inside the list. Worth it from roughly eight options. */
  searchable?: boolean;
  searchLabel?: string;
  noMatchLabel?: string;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
  className?: string;
};

/**
 * Themed single-select (listbox popup). Opt-in replacement for a native <select>.
 * Keys: Arrow/Home/End move, Enter or Space picks, Escape closes and refocuses the trigger, typing jumps to a match.
 */
export function Select({ options, value, onChange, id, name, placeholder = "Select…", searchable = false, searchLabel = "Search", noMatchLabel = "No match", disabled, invalid, describedBy, className = "", ...rest }: SelectProps) {
  const autoId = useId();
  const triggerId = id ?? `${autoId}-trigger`;
  const listId = `${autoId}-list`;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const typed = useRef({ text: "", at: 0 });

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle ? options.filter(option => option.label.toLowerCase().includes(needle)) : options;
  }, [options, query]);
  usePopupPlacement(open, triggerRef, popupRef);
  const selected = options.find(option => option.value === value);

  const openList = () => {
    if (disabled) return;
    setQuery("");
    const index = options.findIndex(option => option.value === value && !option.disabled);
    setActive(index >= 0 ? index : Math.max(0, options.findIndex(option => !option.disabled)));
    setOpen(true);
  };
  const close = (restore: boolean) => { setOpen(false); if (restore) triggerRef.current?.focus(); };
  const pick = (option: SelectOption | undefined) => { if (!option || option.disabled) return; onChange(option.value); close(true); };

  useEffect(() => {
    if (!open) return;
    if (searchable) searchRef.current?.focus();
    const onPointer = (event: PointerEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open, searchable]);
  useEffect(() => { if (open) document.getElementById(`${listId}-${active}`)?.scrollIntoView?.({ block: "nearest" }); }, [active, open, listId]);

  const step = (delta: number) => {
    if (!visible.length) return;
    let next = active;
    for (let tries = 0; tries < visible.length; tries++) {
      next = (next + delta + visible.length) % visible.length;
      if (!visible[next]!.disabled) break;
    }
    setActive(next);
  };

  const onKey = (event: KeyboardEvent) => {
    if (!open) {
      if (event.target === triggerRef.current && ["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) { event.preventDefault(); openList(); }
      return;
    }
    if (event.key === "ArrowDown") { event.preventDefault(); step(1); }
    else if (event.key === "ArrowUp") { event.preventDefault(); step(-1); }
    else if (event.key === "Home") { event.preventDefault(); setActive(Math.max(0, visible.findIndex(option => !option.disabled))); }
    else if (event.key === "End") { event.preventDefault(); setActive(Math.max(0, visible.length - 1 - [...visible].reverse().findIndex(option => !option.disabled))); }
    else if (event.key === "Enter" || (event.key === " " && !searchable)) { event.preventDefault(); pick(visible[active]); }
    else if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(true); }
    else if (event.key === "Tab") setOpen(false);
    else if (!searchable && event.key.length === 1 && !event.metaKey && !event.ctrlKey) {
      const now = Date.now();
      typed.current = { text: (now - typed.current.at > 700 ? "" : typed.current.text) + event.key.toLowerCase(), at: now };
      const hit = visible.findIndex(option => !option.disabled && option.label.toLowerCase().startsWith(typed.current.text));
      if (hit >= 0) setActive(hit);
    }
  };

  const activeId = open && visible[active] ? `${listId}-${active}` : undefined;
  return <div className={`ui-select ${className}`.trim()} ref={rootRef} onKeyDown={onKey}>
    {name && <input type="hidden" name={name} value={value} />}
    <button ref={triggerRef} id={triggerId} type="button" role="combobox" className="ui-select__trigger" aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? listId : undefined}
      aria-activedescendant={!searchable ? activeId : undefined} aria-label={rest["aria-label"]} aria-invalid={invalid || undefined} aria-describedby={describedBy} disabled={disabled}
      onClick={() => open ? close(false) : openList()}>
      {selected?.icon && <span className="ui-select__icon" aria-hidden="true">{selected.icon}</span>}
      <span className={`ui-select__value${selected ? "" : " is-placeholder"}`}>{selected?.label ?? placeholder}</span>
      <IconChevronDown size={16} stroke={1.75} aria-hidden="true" className="ui-select__chevron" />
    </button>
    {open && <div ref={popupRef} className="ui-select__popup">
      {searchable && <div className="ui-select__search"><IconSearch size={15} aria-hidden="true" />
        <input ref={searchRef} role="combobox" aria-expanded="true" aria-controls={listId} aria-activedescendant={activeId} aria-autocomplete="list" aria-label={searchLabel} value={query} autoComplete="off" spellCheck={false}
          onChange={event => { setQuery(event.target.value); setActive(0); }} /></div>}
      <ul id={listId} role="listbox" aria-label={rest["aria-label"] ?? placeholder} className="ui-select__list">
        {visible.length === 0 && <li className="ui-select__empty" role="presentation">{noMatchLabel}</li>}
        {visible.map((option, index) => <li key={option.value} id={`${listId}-${index}`} role="option" aria-selected={option.value === value} aria-disabled={option.disabled || undefined}
          className={`ui-select__option${index === active ? " is-active" : ""}${option.value === value ? " is-selected" : ""}`}
          onPointerEnter={() => !option.disabled && setActive(index)} onMouseDown={event => event.preventDefault()} onClick={() => pick(option)}>
          {option.icon && <span className="ui-select__icon" aria-hidden="true">{option.icon}</span>}
          <span className="ui-select__text"><span>{option.label}</span>{option.description && <small>{option.description}</small>}</span>
          {option.value === value && <IconCheck size={16} stroke={2} aria-hidden="true" />}
        </li>)}
      </ul>
    </div>}
  </div>;
}
