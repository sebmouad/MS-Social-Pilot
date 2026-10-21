import { Badge } from '@/components';
import { feedsText, type FeedsCopyCatalog, type FeedsCopyKey, type FeedsLocale } from '../copy';
import type { RecipeStatus } from './recipe-status';
import styles from './feeds.module.css';

/** Compact health summary of the recipe automation: next slots, today's results, problems and recipe supply. Text comes from the Root `feeds.copy` catalog. */
export function RecipeStatusCard({ status, locale, copy }: { status: RecipeStatus; locale: FeedsLocale; copy?: FeedsCopyCatalog }) {
  const t = (key: FeedsCopyKey, values: Record<string, string | number> = {}) => feedsText(locale, key, values, copy);
  const when = (iso: string) => new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: status.timeZone }).format(new Date(iso));
  const lastRun = status.lastRunAt ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: status.timeZone }).format(new Date(status.lastRunAt)) : t('recipeStatusNever');
  const problems = status.failed + status.uncertain;
  const tone = status.state === 'active' ? 'success' : status.state === 'paused' ? 'neutral' : 'warning';
  const stateLabel = status.state === 'active' ? t('recipeStatusActive') : status.state === 'paused' ? t('recipeStatusPaused') : t('recipeStatusUnavailable');
  const days = status.pool ? status.pool.pages.flatMap(page => page.daysLeft === null ? [] : [page.daysLeft]) : [];
  const fewest = days.length ? Math.min(...days) : null;
  const eligible = status.pool ? status.pool.pages.reduce((best, page) => Math.max(best, page.eligible), 0) : 0;
  return <section className={styles.status} data-module="publishing" aria-labelledby="recipe-status-title">
    <header className={styles.statusHead}>
      <h2 id="recipe-status-title">{t('recipeStatusTitle')}</h2>
      <Badge tone={tone}>{stateLabel}</Badge>
      <span className={styles.statusMeta}>{t('recipeStatusLastRun')}: {lastRun}</span>
    </header>
    <dl className={styles.statusGrid}>
      <div className={styles.statusItem}>
        <dt>{t('recipeStatusNext')}</dt>
        <dd>{status.upcoming.length
          ? <ol className={styles.slotList}>{status.upcoming.map(slot => <li key={`${slot.slotAt}:${slot.targetName}`} title={slot.title}><time dateTime={slot.slotAt}>{when(slot.slotAt)}</time>{slot.targetName ? ` · ${slot.targetName}` : ''}</li>)}</ol>
          : <span className={styles.statusMeta}>{t('recipeStatusNextEmpty')}</span>}</dd>
      </div>
      <div className={styles.statusItem}><dt>{t('recipeStatusToday')}</dt><dd className={styles.statusValue}>{status.publishedToday}</dd></div>
      <div className={styles.statusItem}>
        <dt>{t('recipeStatusProblems')}</dt>
        <dd className={styles.statusValue} data-alert={problems ? 'true' : undefined}>{problems ? problems : t('recipeStatusProblemsNone')}
          {problems ? <span className={styles.statusMeta}>{t('recipeStatusProblemsDetail', { failed: status.failed, uncertain: status.uncertain })}</span> : null}</dd>
      </div>
      <div className={styles.statusItem}>
        <dt>{t('recipeStatusPool')}</dt>
        <dd>{status.pool
          ? <><Badge tone={!status.pool.complete || status.pool.low ? 'warning' : 'success'}>{!status.pool.complete ? t('recipeStatusPoolUnknown') : status.pool.low ? t('recipeStatusPoolLow') : t('recipeStatusPoolOk')}</Badge>
            <span className={styles.statusMeta}>{fewest !== null ? t('recipeStatusPoolDays', { days: fewest }) : t('recipeStatusPoolCount', { count: eligible })}{status.pool.complete ? '' : ' +'}</span></>
          : <span className={styles.statusMeta}>{t('recipeStatusPoolUnknown')}</span>}</dd>
      </div>
    </dl>
  </section>;
}
