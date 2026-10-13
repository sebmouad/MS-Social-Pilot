'use client';

import { useId, useState } from 'react';

export function InfoTip({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const descriptionId = useId();
  return (
    <button
      type="button"
      aria-label={text}
      aria-expanded={open}
      aria-controls={descriptionId}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onClick={() => setOpen((value) => !value)}
      onKeyDown={(event) => { if (event.key === 'Escape') setOpen(false); }}
      onBlur={() => setOpen(false)}
      className="group/tip ms-1 inline-flex h-4 w-4 shrink-0 cursor-help items-center justify-center rounded-full align-[-2px] text-[10px] font-bold text-slate-400 ring-1 ring-slate-300 hover:text-brand-600 hover:ring-brand-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 print:hidden"
    >
      i
      <span
        id={descriptionId}
        role="tooltip"
        className={`pointer-events-none absolute inset-x-2 bottom-full z-40 mb-1 ${open ? 'block' : 'hidden'} rounded-lg bg-slate-900 px-3 py-2 text-start text-xs font-normal leading-snug text-white shadow-lg`}
      >
        {text}
      </span>
    </button>
  );
}
