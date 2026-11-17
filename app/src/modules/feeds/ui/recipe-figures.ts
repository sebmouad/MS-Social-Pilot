import { feedsText, type FeedsCopyCatalog, type FeedsCopyKey, type FeedsLocale } from '../copy';
import type { RecipeStatus } from './recipe-status';

export type RecipeFigure = { key: string; label: string; value: string; detail?: string; alert?: boolean; pending?: boolean };

/**
 * The recipe automation's figures, shown in the recipe source's header (2026-11-17; they were a card of their own that
 * repeated the header). Text comes from the Root `feeds.copy` catalog.
 */
export function recipeFigures(status: RecipeStatus, locale: FeedsLocale, copy?: FeedsCopyCatalog): RecipeFigure[] {
  const t = (key: FeedsCopyKey, values: Record<string, string | number> = {}) => feedsText(locale, key, values, copy);
  const number = (value: number) => new Intl.NumberFormat(locale).format(value);
  const problems = status.failed + status.uncertain;
  const pool = status.pool;
  const days = pool ? pool.pages.flatMap(page => page.daysLeft === null ? [] : [page.daysLeft]) : [];
  const fewest = days.length ? Math.min(...days) : null;
  const eligible = pool ? pool.pages.reduce((best, page) => Math.max(best, page.eligible), 0) : 0;
  // An incomplete count is a large library scanned up to a limit: the figures are minimums (2026-11-15).
  const plus = pool && !pool.complete ? '+' : '';
  return [
    { key: 'today', label: t('recipeStatusToday'), value: number(status.publishedToday) },
    { key: 'check', label: t('recipeStatusProblems'), value: problems ? number(problems) : t('recipeStatusProblemsNone'), ...(problems ? { detail: t('recipeStatusProblemsDetail', { failed: status.failed, uncertain: status.uncertain }), alert: true } : {}) },
    { key: 'pool', label: t('recipeStatusPool'), value: !pool ? t('recipeStatusPoolUnknown') : fewest !== null ? `${t('recipeStatusPoolDays', { days: number(fewest) })}${plus}` : `${t('recipeStatusPoolCount', { count: number(eligible) })}${plus}`,
      ...(pool?.low ? { detail: t('recipeStatusPoolLow'), alert: true } : {}), ...(pool ? {} : { pending: true }) },
  ];
}
