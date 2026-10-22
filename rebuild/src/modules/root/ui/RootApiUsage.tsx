import { headers } from 'next/headers';
import { IconAlertTriangle, IconGauge } from '@tabler/icons-react';
import { Badge } from '@/components/Badge';
import { requireRootPage } from '@/server/config/access';
import { runtimeConfig } from '@/server/config/store';
import { ROOT_API_USAGE_COPY, rootApiUsageCopySchema } from '../api-usage-config';
import { readRootApiUsage } from '../server/api-usage';

/** Latest provider-reported rate-limit readings for one installed platform. */
export async function RootApiUsage({ providerId }: { providerId: string }) {
  const actor = await requireRootPage();
  const locale = /^\s*fr\b/i.test((await headers()).get('accept-language') ?? '') ? 'fr' : 'en';
  const catalog = await runtimeConfig('root.apiUsageCopy').then(value => rootApiUsageCopySchema.parse(value)).catch(() => ROOT_API_USAGE_COPY);
  const copy = catalog[locale];
  const usage = await readRootApiUsage(actor.id, { providerId, locale }).catch(() => null);
  const platform = usage?.platforms[0];
  const unit = (kind: 'percent' | 'seconds' | 'minutes') => kind === 'percent' ? copy.percent : kind === 'seconds' ? copy.seconds : copy.minutes;
  return <section className="root-control__panel" lang={locale} aria-label={copy.title}>
    <h2><IconGauge size={20} aria-hidden="true" /> {copy.title}</h2>
    <p>{copy.intro}</p>
    {!platform || platform.unavailable ? <p role="status">{copy.unavailable}</p> : !platform.scopes.length ? <p role="status">{copy.empty}</p> : platform.scopes.map(scope => <div key={scope.scope} className="root-jobs__table-wrap">
      <table><caption>{scope.label} · {copy.updated}: <time dateTime={scope.capturedAt}>{new Date(scope.capturedAt).toLocaleString(locale, { timeZone: 'UTC' })} {copy.utc}</time> {scope.stale ? <Badge tone="neutral">{copy.stale}</Badge> : null}</caption>
        <thead><tr><th scope="col">{copy.metric}</th><th scope="col">{copy.value}</th></tr></thead>
        <tbody>{scope.metrics.map(metric => <tr key={metric.key}><th scope="row">{metric.label}</th><td>{metric.value} {unit(metric.unit)} {metric.warning ? <Badge tone="warning" icon={<IconAlertTriangle size={14} />}>{copy.warning}</Badge> : null}</td></tr>)}</tbody>
      </table>
    </div>)}
  </section>;
}
