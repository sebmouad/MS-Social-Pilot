import { runtimeConfig } from '@/server/config/store';
import type { FeedActor } from '../server/access';
import { readRecipeSource } from '../server/wordpress';
import { recipeText, type RecipeLocale } from '../copy-recipes';
import { RecipeSupplyWarning } from './RecipeSupplyWarning';
import styles from './feeds.module.css';

/** Home may mount this module-owned card; every read uses the same authorized service as Feeds/REST/MCP. */
export async function RecipeSupplyCard({ actor, locale }: { actor: FeedActor; locale: RecipeLocale }) {
  const view = await readRecipeSource(actor).catch(() => null);
  if (!view?.source) return null;
  const copy = await runtimeConfig('feeds.recipeCopy');
  const t = (key: 'poolHeading' | 'poolUnknown' | 'poolIntro' | 'poolPartial') => recipeText(locale, key, {}, copy);
  return <section className={styles.status} aria-label={t('poolHeading')}>
    <h2>{t('poolHeading')}</h2>
    <RecipeSupplyWarning pool={view.pool} locale={locale} copy={copy} />
    <p className={styles.help}>{view.pool ? `${t('poolIntro')}${view.pool.complete ? '' : ` ${t('poolPartial')}`}` : t('poolUnknown')}</p>
  </section>;
}
