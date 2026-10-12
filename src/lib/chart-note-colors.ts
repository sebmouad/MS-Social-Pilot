/**
 * Notes on charts (NEXT_PHASES H13), the parts the browser needs. Plain
 * module: no database.
 */
import type { PaletteKey } from './palette';

/** The palette as plain colours, for marks drawn in SVG. */
export const NOTE_HEX: Record<PaletteKey, string> = {
  blue: '#1877f2',
  green: '#10b981',
  amber: '#f59e0b',
  red: '#f43f5e',
  purple: '#8b5cf6',
  pink: '#ec4899',
  teal: '#14b8a6',
  slate: '#64748b',
};

export const NOTE_LABEL_MAX = 80;

export interface ChartNoteView {
  id: string;
  /** yyyy-MM-dd on the workspace's calendar. */
  day: string;
  label: string;
  color: PaletteKey;
  /** False for a note on every Page. */
  pageOnly: boolean;
}
