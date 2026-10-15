"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { THEME_COOKIE, THEMES, type ThemeId } from '@/lib/themes';
export { THEME_COOKIE, THEMES, type ThemeId } from '@/lib/themes';

const ThemeContext = createContext<{ theme: ThemeId; setTheme: (theme: ThemeId) => void } | null>(null);
const isThemeId = (value: string): value is ThemeId => THEMES.some(theme => theme.id === value);

export function ThemeProvider({ initialTheme, children }: { initialTheme: string; children: ReactNode }) {
  const [theme, setCurrentTheme] = useState<ThemeId>(isThemeId(initialTheme) ? initialTheme : THEMES[0].id);
  const setTheme = useCallback((nextTheme: ThemeId) => {
    setCurrentTheme(nextTheme);
    document.documentElement.dataset.theme = nextTheme;
    document.cookie = `${THEME_COOKIE}=${nextTheme}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`;
    window.dispatchEvent(new CustomEvent('theme-change', { detail: nextTheme }));
  }, []);
  const value = useMemo(() => ({ theme, setTheme }), [theme, setTheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useTheme must be used inside ThemeProvider');
  return value;
}
