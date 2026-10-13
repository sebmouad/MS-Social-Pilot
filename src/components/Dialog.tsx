'use client';

import { useId, useRef, type ReactNode } from 'react';

import { Icon } from './Icon';
import { useModalFocus } from './useModalFocus';

/**
 * A centred dialog over a dimmed screen, as Facebook draws "Create post":
 * a title bar with a round close button, the body, and the actions under it.
 *
 * Escape and a click on the backdrop close it; focus moves into it when it
 * opens and back to whatever opened it when it closes.
 */
export function Dialog({
  open,
  title,
  onClose,
  children,
  footer,
  closeLabel,
  wide = false,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  closeLabel: string;
  wide?: boolean;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useModalFocus(panel, open, onClose);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-white/70 p-0 backdrop-blur-[2px] sm:items-center sm:p-4"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl ring-1 ring-black/5 sm:rounded-xl ${
          wide ? 'sm:max-w-2xl' : 'sm:max-w-lg'
        }`}
      >
        <div className="relative flex items-center justify-center border-b border-slate-200 px-12 py-3.5">
          <h2 id={titleId} className="text-center text-xl font-bold leading-snug text-slate-900 [text-wrap:balance]">
            {title}
          </h2>
          <button
            type="button"
            data-close
            className="absolute end-3 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-slate-200 text-slate-600 hover:bg-slate-300"
            aria-label={closeLabel}
            onClick={onClose}
          >
            <Icon name="close" size={18} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">{children}</div>
        {footer && <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-4 py-3 sm:px-5">{footer}</div>}
      </div>
    </div>
  );
}
