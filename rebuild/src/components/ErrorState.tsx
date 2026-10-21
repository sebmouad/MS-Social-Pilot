'use client';
import { useEffect, useState } from 'react';
import { isModeId, isThemeId, MODE_COOKIE, THEME_COOKIE, type ModeId, type ThemeId } from '@/lib/themes';

/**
 * Last-resort screens for a failed render or an unknown route. They must work when the database and the
 * Root configuration are unreachable, so their copy is a fixed bilingual catalog instead of a Root setting
 * (the documented bootstrap exception); everything else about them uses the shared tokens and buttons.
 */
export type ErrorLocale = 'en' | 'fr';
export const ERROR_STATE_COPY = {
  en: {
    errorTitle: 'We couldn’t load this page', errorBody: 'Your work is still here. Try loading the page again.', retry: 'Try again', home: 'Back to home',
    notFoundTitle: 'This page doesn’t exist', notFoundBody: 'The link may be out of date, or you may not have access to it.',
  },
  fr: {
    errorTitle: 'Impossible de charger cette page', errorBody: 'Votre travail est toujours là. Essayez de recharger la page.', retry: 'Réessayer', home: 'Retour à l’accueil',
    notFoundTitle: 'Cette page n’existe pas', notFoundBody: 'Le lien est peut-être périmé, ou vous n’y avez pas accès.',
  },
} as const satisfies Record<ErrorLocale, Record<string, string>>;

export const localeFrom = (value: string | null | undefined): ErrorLocale => (/^\s*fr\b/i.test(value ?? '') ? 'fr' : 'en');

/** The page's own language (set by the layout from Accept-Language), else the browser's. Starts as English so hydration matches. */
export function useErrorLocale(): ErrorLocale {
  const [locale, setLocale] = useState<ErrorLocale>('en');
  useEffect(() => { setLocale(localeFrom(document.documentElement.getAttribute('lang') && document.documentElement.lang !== 'en' ? document.documentElement.lang : navigator.language)); }, []);
  return locale;
}

export function ErrorState({ kind, locale, onRetry }: { kind: 'error' | 'not-found'; locale: ErrorLocale; onRetry?: () => void }) {
  const copy = ERROR_STATE_COPY[locale];
  const error = kind === 'error';
  return <main className="route-state" role={error ? 'alert' : undefined} id="main-content">
    <h1>{error ? copy.errorTitle : copy.notFoundTitle}</h1>
    <p>{error ? copy.errorBody : copy.notFoundBody}</p>
    <div className="route-state__actions">
      {onRetry ? <button type="button" className="ui-button ui-button--primary ui-button--md" onClick={onRetry}>{copy.retry}</button> : null}
      <a className={`ui-button ui-button--${onRetry ? 'secondary' : 'primary'} ui-button--md`} href="/home">{copy.home}</a>
    </div>
  </main>;
}

function cookie(name: string): string | undefined {
  return document.cookie.split('; ').find(part => part.startsWith(`${name}=`))?.slice(name.length + 1);
}

/** Replaces the whole document when even the root layout fails: it applies the visitor's stored theme and mode itself. */
export function GlobalErrorState({ reset }: { reset: () => void }) {
  const locale = useErrorLocale();
  const [theme, setTheme] = useState<ThemeId>('vivid');
  const [mode, setMode] = useState<ModeId>('system');
  useEffect(() => {
    const storedTheme = cookie(THEME_COOKIE), storedMode = cookie(MODE_COOKIE);
    if (isThemeId(storedTheme)) setTheme(storedTheme);
    if (isModeId(storedMode)) setMode(storedMode);
  }, []);
  return <html lang={locale} data-theme={theme} data-mode={mode}><body><ErrorState kind="error" locale={locale} onRetry={reset} /></body></html>;
}
