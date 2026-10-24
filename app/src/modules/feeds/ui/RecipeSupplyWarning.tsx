import { recipeCopy, recipeText, type RecipeCopyCatalog, type RecipeLocale } from '../copy-recipes';
import type { RecipePool } from './RecipeSource';
import styles from './feeds.module.css';

/** Shared warning for Feeds and the Home card. A capped scan cannot establish low supply. */
export function RecipeSupplyWarning({ pool, locale, copy = recipeCopy }: { pool: RecipePool | null; locale: RecipeLocale; copy?: RecipeCopyCatalog }) {
  if (!pool?.complete || !pool.low) return null;
  return <p role="status" className={styles.error} data-alert="true">{recipeText(locale, 'poolLow', { count: pool.pages.filter(p => p.low).length, days: pool.warnDays }, copy)}</p>;
}
