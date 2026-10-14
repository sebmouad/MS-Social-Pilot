"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

export const THEME_COOKIE = 'social-pilot-theme';
export const THEMES = [
  { id: 'grove', name: 'Grove', description: 'Soft greens with a calm, natural feel.', swatches: ['#f5f7f4', '#286b4b', '#e4f2e9'] },
  { id: 'coast', name: 'Coast', description: 'Cool blues inspired by open water and sky.', swatches: ['#f2f7fa', '#17698a', '#dff0f7'] },
  { id: 'clay', name: 'Clay', description: 'Warm terracotta with a soft, earthy canvas.', swatches: ['#fbf5f0', '#a54e2c', '#f6e5db'] },
  { id: 'nightfall', name: 'Nightfall', description: 'A deep slate workspace with softened contrast.', swatches: ['#111a20', '#79c8a2', '#24483b'] },
] as const;
export type ThemeId = typeof THEMES[number]['id'];

const ThemeContext = createContext<{ theme: ThemeId; setTheme: (theme: ThemeId) => void } | null>(null);
const isThemeId = (value: string): value is ThemeId => THEMES.some(theme => theme.id === value);

export function ThemeProvider({ initialTheme, children }: { initialTheme: string; children: ReactNode }) {
  const [theme, setCurrentTheme] = useState<ThemeId>(isThemeId(initialTheme) ? initialTheme : 'grove');
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
