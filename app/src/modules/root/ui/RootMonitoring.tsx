import { DataTable } from '@/components/DataTable';
import { headers } from 'next/headers';
import { requireRootPage } from '@/server/config/access';
import { runtimeConfig } from '@/server/config/store';
import { ROOT_MONITORING_COPY, rootMonitoringCopySchema } from '../monitoring-config';
import { readRootOperatorMonitoring } from '../server/operator-monitoring';
import { MonitoringAction } from './MonitoringAction';
export async function RootMonitoring() {
  const actor = await requireRootPage();
  const locale = /^\s*fr\b/i.test((await headers()).get('accept-language') ?? '') ? 'fr' : 'en';
  const catalog = await runtimeConfig('root.monitoringCopy').then(value => rootMonitoringCopySchema.parse(value)).catch(() => ROOT_MONITORING_COPY);
  const copy = catalog[locale];
  let monitoring: Awaited<ReturnType<typeof readRootOperatorMonitoring>>;
  try { monitoring = await readRootOperatorMonitoring(actor.id); }
  catch { return <section className="root-jobs" lang={locale}><h2>{copy.title}</h2><p role="alert">{copy.unavailable}</p></section>; }
  return <section className="root-jobs" lang={locale} aria-label={copy.title}>
    <h2>{copy.title}</h2><p>{copy.intro}</p>
    <MonitoringAction copy={copy} confirmation={monitoring.confirmation} testConfirmation={monitoring.testConfirmation} />
    <h3>{copy.alerts}</h3>
    {monitoring.alerts.length ? <ul className="root-jobs__latest">{monitoring.alerts.map(alert => <li key={alert.id}><strong>{alert.key}</strong><span>{copy.opened}: <time dateTime={alert.openedAt}>{new Date(alert.openedAt).toLocaleString(locale, { timeZone: 'UTC' })} {copy.utc}</time></span></li>)}</ul> : <p>{copy.empty}</p>}
    <h3>{copy.history}</h3>
    <DataTable caption={copy.history} rows={monitoring.incidentHistory ?? []} rowKey={row => row.id} emptyMessage={copy.noHistory} zebra={false} columns={[
      { key: 'key', label: copy.signal, render: row => <strong>{row.key}</strong> },
      { key: 'opened', label: copy.opened, render: row => <time dateTime={row.openedAt}>{new Date(row.openedAt).toLocaleString(locale, { timeZone: 'UTC' })} {copy.utc}</time> },
      { key: 'resolved', label: copy.resolved, render: row => row.resolvedAt ? <time dateTime={row.resolvedAt}>{new Date(row.resolvedAt).toLocaleString(locale, { timeZone: 'UTC' })} {copy.utc}</time> : copy.active },
    ]} />
    <h3>{copy.deliveries}</h3><p>{copy.deliveryIntro}</p>
    {monitoring.deliveries.length ? <div className="root-jobs__table-wrap"><table><caption>{copy.deliveries}</caption><thead><tr><th scope="col">{copy.signal}</th><th scope="col">{copy.event}</th><th scope="col">{copy.deliveryStatus}</th><th scope="col">{copy.created}</th><th scope="col">{copy.finished}</th></tr></thead><tbody>{monitoring.deliveries.map(delivery => <tr key={delivery.id}><td>{delivery.key}</td><td>{delivery.key === 'monitoring.test' ? copy.testEvent : delivery.state === 'open' ? copy.openedEvent : delivery.state === 'resolved' ? copy.resolvedEvent : delivery.state}</td><td>{({ pending: copy.pendingStatus, sending: copy.sendingStatus, sent: copy.sentStatus, failed: copy.failedStatus, unavailable: copy.unavailableStatus, uncertain: copy.uncertainStatus } as Record<string, string>)[delivery.status] ?? copy.unknown}</td><td><time dateTime={delivery.createdAt}>{new Date(delivery.createdAt).toLocaleString(locale, { timeZone: 'UTC' })} {copy.utc}</time></td><td>{delivery.finishedAt ? <time dateTime={delivery.finishedAt}>{new Date(delivery.finishedAt).toLocaleString(locale, { timeZone: 'UTC' })} {copy.utc}</time> : copy.unknown}</td></tr>)}</tbody></table></div> : <p>{copy.noDeliveries}</p>}
    <h3>{copy.availability}</h3>
    {monitoring.uptime.length ? <div className="root-jobs__table-wrap"><table><caption>{copy.availability}</caption><thead><tr><th scope="col">{copy.day}</th><th scope="col">{copy.component}</th><th scope="col">{copy.minutes}</th></tr></thead><tbody>{monitoring.uptime.map(row => <tr key={`${row.day}:${row.component}`}><td>{row.day}</td><td>{row.component === 'app' ? copy.app : row.component === 'worker' ? copy.worker : row.component}</td><td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{row.minutes}</td></tr>)}</tbody></table></div> : <p>{copy.noUptime}</p>}
  </section>;
}
