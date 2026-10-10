'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

import { Icon } from './Icon';

export interface SplitOption<V extends string> {
  value: V;
  label: string;
  description?: string;
  disabled?: boolean;
  /** Said under a disabled option, in place of its description. */
  reason?: string;
}

/**
 * A primary button with its other modes behind a caret: "Schedule ▾" with
 * "Add to queue" and "Publish now" in the menu. Choosing from the menu
 * changes what the button does; it never sends anything by itself, so a
 * slip of the mouse in the menu cannot publish a post.
 */
export function SplitButton<V extends string>({
  label,
  value,
  options,
  onChoose,
  onClick,
  disabled,
  menuLabel,
  describedBy,
  icon,
}: {
  label: ReactNode;
  value: V;
  options: Array<SplitOption<V>>;
  onChoose: (value: V) => void;
  onClick: () => void;
  disabled?: boolean;
  menuLabel: string;
  describedBy?: string;
  icon?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => !box.current?.contains(event.target as Node) && setOpen(false);
    const escape = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  return (
    <div ref={box} className="relative flex flex-1">
      <button
        type="button"
        className="btn-primary flex-1 rounded-r-none"
        disabled={disabled}
        aria-describedby={describedBy}
        onClick={onClick}
      >
        {icon}
        {label}
      </button>
      {options.length > 1 && (
        <button
          type="button"
          // Still opens while the main button cannot send: changing the mode is
          // allowed before the post is ready. It only looks the same, so the
          // pair reads as one control.
          className={`btn-primary rounded-l-none border-l border-white/30 px-2.5 ${disabled ? 'opacity-50' : ''}`}
          aria-label={menuLabel}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
        >
          <Icon name="chevronDown" size={16} />
        </button>
      )}
      {open && (
        <div
          role="menu"
          aria-label={menuLabel}
          className="absolute bottom-full right-0 z-30 mb-2 w-72 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg"
        >
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              role="menuitemradio"
              aria-checked={option.value === value}
              disabled={option.disabled}
              className={`flex w-full items-start gap-2.5 px-3 py-2 text-left disabled:cursor-not-allowed disabled:opacity-50 ${
                option.value === value ? 'bg-brand-50' : 'hover:bg-slate-50'
              }`}
              onClick={() => {
                setOpen(false);
                onChoose(option.value);
              }}
            >
              <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center text-brand-600">
                {option.value === value && <Icon name="check" size={15} />}
              </span>
              <span className="min-w-0">
                <span className={`block text-sm font-semibold ${option.value === value ? 'text-brand-700' : 'text-slate-900'}`}>
                  {option.label}
                </span>
                {(option.disabled ? option.reason : option.description) && (
                  <span className="block text-xs text-slate-500">{option.disabled ? option.reason : option.description}</span>
                )}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
