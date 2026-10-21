import { Badge } from '@/components';
import { originText, type OriginLocale } from './origin-copy';
import type { RecipeStatus } from './recipe-status';
import styles from './feeds.module.css';

/** Compact health summary of the recipe automation: next slots, today's results, problems and recipe supply. */
export function RecipeStatusCard({ status, locale }: { status: RecipeStatus; locale: OriginLocale }) {
  const t = (key: Parameters<typeof originText>[1], values: Record<string, string | number> = {}) => originText(locale, key, values);
  const when = (iso: string) => new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: status.timeZone }).format(new Date(iso));
  const lastRun = status.lastRunAt ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: status.timeZone }).format(new Date(status.lastRunAt)) : t('never');
  const problems = status.failed + status.uncertain;
  const tone = status.state === 'active' ? 'success' : status.state === 'paused' ? 'neutral' : 'warning';
  const stateLabel = status.state === 'active' ? t('statusActive') : status.state === 'paused' ? t('statusPaused') : t('statusUnavailable');
  const days = status.pool ? status.pool.pages.flatMap(page => page.daysLeft === null ? [] : [page.daysLeft]) : [];
  const fewest = days.length ? Math.min(...days) : null;
  const eligible = status.pool ? status.pool.pages.reduce((best, page) => Math.max(best, page.eligible), 0) : 0;
  return <section className={styles.status} data-module="publishing" aria-labelledby="recipe-status-title">
    <header className={styles.statusHead}>
      <h2 id="recipe-status-title">{t('statusTitle')}</h2>
      <Badge tone={tone}>{stateLabel}</Badge>
      <span className={styles.statusMeta}>{t('lastRun')}: {lastRun}</span>
    </header>
    <dl className={styles.statusGrid}>
      <div className={styles.statusItem}>
        <dt>{t('nextSlots')}</dt>
        <dd>{status.upcoming.length
          ? <ol className={styles.slotList}>{status.upcoming.map(slot => <li key={`${slot.slotAt}:${slot.targetName}`} title={slot.title}><time dateTime={slot.slotAt}>{when(slot.slotAt)}</time>{slot.targetName ? ` · ${slot.targetName}` : ''}</li>)}</ol>
          : <span className={styles.statusMeta}>{t('nextEmpty')}</span>}</dd>
      </div>
      <div className={styles.statusItem}><dt>{t('publishedToday')}</dt><dd className={styles.statusValue}>{status.publishedToday}</dd></div>
      <div className={styles.statusItem}>
        <dt>{t('failures')}</dt>
        <dd className={styles.statusValue} data-alert={problems ? 'true' : undefined}>{problems ? problems : t('failuresNone')}
          {problems ? <span className={styles.statusMeta}>{t('failuresDetail', { failed: status.failed, uncertain: status.uncertain })}</span> : null}</dd>
      </div>
      <div className={styles.statusItem}>
        <dt>{t('pool')}</dt>
        <dd>{status.pool
          ? <><Badge tone={status.pool.low ? 'warning' : 'success'}>{status.pool.low ? t('poolLow') : t('poolOk')}</Badge>
            <span className={styles.statusMeta}>{fewest !== null ? t('poolDays', { days: fewest }) : t('poolCount', { count: eligible })}{status.pool.complete ? '' : ' +'}</span></>
          : <span className={styles.statusMeta}>{t('poolUnknown')}</span>}</dd>
      </div>
    </dl>
  </section>;
}
