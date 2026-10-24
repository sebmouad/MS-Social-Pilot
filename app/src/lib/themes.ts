/** Shared theme metadata, safe to import from server and client modules.
 * A theme is a palette; every theme has a light and a dark mode. Tokens live in src/styles/tokens.css. */
export const THEME_COOKIE = 'social-pilot-theme';
export const MODE_COOKIE = 'social-pilot-mode';
export const THEMES = [
  { id: 'vivid', name: 'Vivid', description: 'Soft violet ground with a violet accent ladder.', swatches: ['#f6f5fd', '#534AB7', '#EEEDFE', '#3C3489'] },
  { id: 'meta', name: 'Meta blue', description: 'Pale blue ground with a blue accent ladder.', swatches: ['#f3f6fa', '#185FA5', '#E6F1FB', '#0C447C'] },
  { id: 'warm', name: 'Warm', description: 'Warm cream ground with a terracotta accent ladder.', swatches: ['#fdf8f2', '#B4461F', '#FAECE7', '#993C1D'] },
  { id: 'clean', name: 'Clean', description: 'Near-white ground with a blue accent ladder; color only where it carries meaning.', swatches: ['#f9fafb', '#185FA5', '#E6F1FB', '#0C447C'] },
] as const;
export type ThemeId = typeof THEMES[number]['id'];
/** Theme for visitors with no saved choice (owner decision 2026-10-21: Clean). Root `theme.default` may override it. */
export const DEFAULT_THEME: ThemeId = 'clean';
export const MODES = [
  { id: 'light', name: 'Light' },
  { id: 'dark', name: 'Dark' },
  { id: 'system', name: 'Match device' },
] as const;
export type ModeId = typeof MODES[number]['id'];
export const isThemeId = (value: unknown): value is ThemeId => THEMES.some(theme => theme.id === value);
export const isModeId = (value: unknown): value is ModeId => MODES.some(mode => mode.id === value);
