import { headers } from 'next/headers';
import { IconWebhook } from '@tabler/icons-react';
import { requireRootPage } from '@/server/config/access';
import { readRootWebhookDeliveries } from '../server/webhook-deliveries';

/** Recent inbound-webhook receipts for one installed platform; omitted when the module has none. */
export async function RootWebhookDeliveries({ providerId }: { providerId: string }) {
  const actor = await requireRootPage();
  const locale = /^\s*fr\b/i.test((await headers()).get('accept-language') ?? '') ? 'fr' : 'en';
  const view = await readRootWebhookDeliveries(actor.id, { providerId, locale }).catch(() => null);
  if (!view || !view.supported) return null;
  const copy = view.copy;
  const detail = (row: NonNullable<typeof view.deliveries>[number]) => {
    if (row.detail.reason === 'webhooks_disabled') return copy.disabled;
    if (row.detail.reason === 'unknown_event') return copy.unknownEvent;
    const parts: string[] = [];
    if (row.detail.verb) parts.push(`${copy.verb}: ${row.detail.verb}`);
    if (row.detail.written !== undefined) parts.push(`${row.detail.written} ${copy.written}`);
    if (row.detail.errors?.length) parts.push(`${row.detail.errors.length} × write_failed`);
    return parts.join(' · ') || '—';
  };
  return <section className="root-control__panel" lang={locale} aria-label={copy.title}>
    <h2><IconWebhook size={20} aria-hidden="true" /> {copy.title}</h2>
    <p>{copy.intro}</p>
    {view.deliveries === null ? <p role="status">{copy.unavailable}</p>
      : !view.deliveries.length ? <p role="status">{copy.empty}</p>
      : <div className="root-jobs__table-wrap"><table>
        <thead><tr><th scope="col">{copy.received}</th><th scope="col">{copy.page}</th><th scope="col">{copy.kind}</th><th scope="col">{copy.status}</th><th scope="col">{copy.targets}</th><th scope="col">{copy.detail}</th></tr></thead>
        <tbody>{view.deliveries.map(row => <tr key={row.id}>
          <td><time dateTime={row.receivedAt.toISOString()}>{row.receivedAt.toLocaleString(locale, { timeZone: 'UTC' })}</time></td>
          <td>{row.pageId}</td>
          <td>{copy.kinds[row.eventKind]}</td>
          <td>{copy.statuses[row.status]}</td>
          <td>{row.matchedTargets}</td>
          <td>{detail(row)}</td>
        </tr>)}</tbody>
      </table></div>}
  </section>;
}
