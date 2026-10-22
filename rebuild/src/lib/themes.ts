/** Shared theme metadata, safe to import from server and client modules.
 * A theme is a palette; every theme has a light and a dark mode. Tokens live in src/styles/tokens.css. */
export const THEME_COOKIE = 'social-pilot-theme';
export const MODE_COOKIE = 'social-pilot-mode';
export const THEMES = [
  { id: 'vivid', name: 'Vivid', description: 'Deep indigo navigation with a color for every module.', swatches: ['#26215C', '#7F77DD', '#D85A30', '#1D9E75'] },
  { id: 'meta', name: 'Meta blue', description: 'Clean light navigation with a blue accent and colorful data.', swatches: ['#f3f6fa', '#185FA5', '#378ADD', '#1D9E75'] },
  { id: 'warm', name: 'Warm', description: 'Cream and coral, rounded and friendly.', swatches: ['#FAEEDA', '#D85A30', '#FAC775', '#1D9E75'] },
  { id: 'clean', name: 'Clean', description: 'Near-white and crisp gray; color only in icons and charts.', swatches: ['#ffffff', '#111318', '#2563eb', '#16a34a'] },
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
