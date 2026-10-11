'use client';

import { useEffect, useState, type ReactNode } from 'react';

import { Icon } from './Icon';

/** A card the reader can close for good, remembered in this browser. */
export function DismissibleCard({ storageKey, closeLabel, children }: { storageKey: string; closeLabel: string; children: ReactNode }) {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    try {
      setHidden(window.localStorage.getItem(storageKey) === '1');
    } catch {
      // Storage off: the card simply shows.
    }
  }, [storageKey]);
  if (hidden) return null;
  return (
    <section className="card relative overflow-hidden">
      <button
        type="button"
        className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100"
        aria-label={closeLabel}
        title={closeLabel}
        onClick={() => {
          setHidden(true);
          try {
            window.localStorage.setItem(storageKey, '1');
          } catch {
            // As above.
          }
        }}
      >
        <Icon name="close" size={16} />
      </button>
      {children}
    </section>
  );
}
