"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { MODE_COOKIE, THEME_COOKIE, THEMES, isModeId, isThemeId, type ModeId, type ThemeId } from '@/lib/themes';
export { MODE_COOKIE, MODES, THEME_COOKIE, THEMES, type ModeId, type ThemeId } from '@/lib/themes';

type ThemeState = { theme: ThemeId; mode: ModeId; setTheme: (theme: ThemeId) => void; setMode: (mode: ModeId) => void };
const ThemeContext = createContext<ThemeState | null>(null);

function remember(name: string, value: string) {
  document.cookie = `${name}=${value}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`;
}

export function ThemeProvider({ initialTheme, initialMode, children }: { initialTheme: string; initialMode?: string; children: ReactNode }) {
  const [theme, setCurrentTheme] = useState<ThemeId>(isThemeId(initialTheme) ? initialTheme : THEMES[0].id);
  const [mode, setCurrentMode] = useState<ModeId>(isModeId(initialMode) ? initialMode : 'system');
  const setTheme = useCallback((nextTheme: ThemeId) => {
    setCurrentTheme(nextTheme);
    document.documentElement.dataset.theme = nextTheme;
    remember(THEME_COOKIE, nextTheme);
    window.dispatchEvent(new CustomEvent('theme-change', { detail: nextTheme }));
  }, []);
  const setMode = useCallback((nextMode: ModeId) => {
    setCurrentMode(nextMode);
    document.documentElement.dataset.mode = nextMode;
    remember(MODE_COOKIE, nextMode);
    window.dispatchEvent(new CustomEvent('theme-change', { detail: document.documentElement.dataset.theme }));
  }, []);
  const value = useMemo(() => ({ theme, mode, setTheme, setMode }), [theme, mode, setTheme, setMode]);
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
