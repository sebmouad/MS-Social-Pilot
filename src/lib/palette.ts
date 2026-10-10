/**
 * Shared by Page groups and post labels, and safe to import in the browser:
 * nothing here reaches the database.
 */

/**
 * The colours a group or label can take. Literal class names, because
 * Tailwind only ships classes it can find written out in the source.
 */
export const PALETTE = {
  blue: { dot: 'bg-brand-500', chip: 'bg-brand-50 text-brand-700 ring-brand-200' },
  green: { dot: 'bg-emerald-500', chip: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  amber: { dot: 'bg-amber-500', chip: 'bg-amber-50 text-amber-800 ring-amber-200' },
  red: { dot: 'bg-rose-500', chip: 'bg-rose-50 text-rose-700 ring-rose-200' },
  purple: { dot: 'bg-violet-500', chip: 'bg-violet-50 text-violet-700 ring-violet-200' },
  pink: { dot: 'bg-pink-500', chip: 'bg-pink-50 text-pink-700 ring-pink-200' },
  teal: { dot: 'bg-teal-500', chip: 'bg-teal-50 text-teal-700 ring-teal-200' },
  slate: { dot: 'bg-slate-500', chip: 'bg-slate-100 text-slate-700 ring-slate-200' },
} as const;

export type PaletteKey = keyof typeof PALETTE;
export const PALETTE_KEYS = Object.keys(PALETTE) as PaletteKey[];

export function paletteOf(color: string | null | undefined): (typeof PALETTE)[PaletteKey] {
  return PALETTE[(color ?? 'blue') as PaletteKey] ?? PALETTE.blue;
}
