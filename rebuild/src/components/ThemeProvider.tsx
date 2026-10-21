"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { THEMES, isModeId, isThemeId, type ModeId, type ThemeId } from '@/lib/themes';
import { appearanceCopy, type AppearanceCopy } from '@/modules/settings/ui/appearance/copy';
export { MODE_COOKIE, MODES, THEME_COOKIE, THEMES, type ModeId, type ThemeId } from '@/lib/themes';

type Appearance = { theme: ThemeId; mode: ModeId };
type ThemeState = Appearance & {
  setTheme: (theme: ThemeId) => Promise<void>;
  setMode: (mode: ModeId) => Promise<void>;
  saveAppearance: (value: Appearance) => Promise<void>;
  previewAppearance: (value: Partial<Appearance>) => void;
  busy: boolean;
  copy: AppearanceCopy;
};
const ThemeContext = createContext<ThemeState | null>(null);

export function ThemeProvider({ initialTheme, initialMode, copy = appearanceCopy.en, children }: { initialTheme: string; initialMode?: string; copy?: AppearanceCopy; children: ReactNode }) {
  const [theme, setCurrentTheme] = useState<ThemeId>(isThemeId(initialTheme) ? initialTheme : THEMES[0].id);
  const [mode, setCurrentMode] = useState<ModeId>(isModeId(initialMode) ? initialMode : 'system');
  const saved = useRef<Appearance>({ theme, mode });
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  // Draft previews never write cookies or account data. Only the shared service commits.
  const previewAppearance = useCallback((value: Partial<Appearance>) => {
    if (value.theme) { setCurrentTheme(value.theme); document.documentElement.dataset.theme = value.theme; }
    if (value.mode) { setCurrentMode(value.mode); document.documentElement.dataset.mode = value.mode; }
    window.dispatchEvent(new CustomEvent('theme-change', { detail: document.documentElement.dataset.theme }));
  }, []);
  const saveAppearance = useCallback(async (value: Appearance) => {
    if (inFlight.current) throw new Error(copy.failed);
    inFlight.current = true; setBusy(true);
    try {
      const response = await fetch('/api/settings/appearance', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...value, confirmation: 'UPDATE APPEARANCE' }) });
      if (!response.ok) throw new Error(copy.failed);
      saved.current = value;
      previewAppearance(value);
      // The response sets both cache cookies using the Root-configured lifetime.
    } finally { inFlight.current = false; setBusy(false); }
  }, [copy.failed, previewAppearance]);
  const setTheme = useCallback((next: ThemeId) => saveAppearance({ ...saved.current, theme: next }), [saveAppearance]);
  const setMode = useCallback((next: ModeId) => saveAppearance({ ...saved.current, mode: next }), [saveAppearance]);
  const value = useMemo(() => ({ theme, mode, setTheme, setMode, saveAppearance, previewAppearance, busy, copy }), [theme, mode, setTheme, setMode, saveAppearance, previewAppearance, busy, copy]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useTheme must be used inside ThemeProvider');
  return value;
}

/** Same as useTheme, but null outside a provider (isolated renders, tests). */
export function useOptionalTheme() {
  return useContext(ThemeContext);
}
