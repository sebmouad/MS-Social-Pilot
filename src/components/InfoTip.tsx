/**
 * The ⓘ beside a metric's name: what the figure counts, in a sentence, on
 * hover or keyboard focus. A span, not a button, so it can sit inside a card
 * that is itself a button; it is focusable, and screen readers read the
 * definition as its label.
 */
export function InfoTip({ text }: { text: string }) {
  return (
    <span
      tabIndex={0}
      role="img"
      aria-label={text}
      className="group/tip relative ml-1 inline-flex h-4 w-4 shrink-0 cursor-help items-center justify-center rounded-full align-[-2px] text-[10px] font-bold text-slate-400 ring-1 ring-slate-300 hover:text-brand-600 hover:ring-brand-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 print:hidden"
    >
      i
      <span
        aria-hidden
        className="pointer-events-none absolute bottom-full left-1/2 z-40 mb-2 hidden w-56 -translate-x-1/2 rounded-lg bg-slate-900 px-3 py-2 text-left text-xs font-normal leading-snug text-white shadow-lg group-hover/tip:block group-focus/tip:block"
      >
        {text}
      </span>
    </span>
  );
}
