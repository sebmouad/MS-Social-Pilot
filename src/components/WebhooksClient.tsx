'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';

import { useConfirm } from './ConfirmProvider';
import { Dialog } from './Dialog';

/** Same list as `WEBHOOK_EVENTS` in src/lib/webhooks.ts (a server module). */
const EVENTS = ['post.scheduled', 'post.published', 'post.failed', 'comment.received', 'page.disconnected', 'report.ready'] as const;
type Event = (typeof EVENTS)[number];

interface Webhook {
  id: string;
  name: string;
  url: string;
  events: Event[];
  enabled: boolean;
  lastError: string | null;
  lastSent: string | null;
  viaApi: boolean;
}

interface Delivery {
  id: string;
  event: string;
  status: 'pending' | 'delivered' | 'failed';
  attempts: number;
  responseStatus: number | null;
  error: string | null;
  createdAt: string;
}

/** Event names as the payload carries them, shown as labels: `post.published` → `post_published`. */
const key = (event: string) => event.replace('.', '_');

/**
 * Outgoing webhooks (NEXT_PHASES H18). The secret is shown once, right after
 * adding; the log lists the last deliveries with a way to send one again.
 */
export function WebhooksClient({ webhooks }: { webhooks: Webhook[] }) {
  const t = useTranslations('webhooks');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const confirm = useConfirm();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [events, setEvents] = useState<Event[]>(['post.published', 'post.failed']);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [secret, setSecret] = useState<{ id: string; value: string } | null>(null);
  const [notice, setNotice] = useState<{ id: string; text: string; bad: boolean } | null>(null);
  const [log, setLog] = useState<{ id: string; deliveries: Delivery[] | null } | null>(null);
  const close = useCallback(() => {
    setOpen(false);
    setError(null);
  }, []);

  const toggle = (list: Event[], event: Event) => (list.includes(event) ? list.filter((value) => value !== event) : [...list, event]);

  async function add() {
    setPending(true);
    setError(null);
    const response = await fetch('/api/webhooks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, url, events }),
    }).catch(() => null);
    setPending(false);
    const body = (await response?.json().catch(() => ({}))) as { id?: string; secret?: string; error?: string; fields?: Record<string, string> } | undefined;
    if (!response?.ok || !body?.id || !body.secret) {
      setError(Object.values(body?.fields ?? {})[0] ?? body?.error ?? tCommon('genericError'));
      return;
    }
    setSecret({ id: body.id, value: body.secret });
    setName('');
    setUrl('');
    setOpen(false);
    router.refresh();
  }

  async function patch(webhook: Webhook, data: Partial<Pick<Webhook, 'enabled' | 'events'>>) {
    await fetch(`/api/webhooks/${webhook.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(data),
    }).catch(() => null);
    router.refresh();
  }

  async function loadLog(id: string) {
    setLog({ id, deliveries: null });
    const response = await fetch(`/api/webhooks/${id}`).catch(() => null);
    const body = (await response?.json().catch(() => ({}))) as { deliveries?: Delivery[] } | undefined;
    setLog({ id, deliveries: body?.deliveries ?? [] });
  }

  async function test(webhook: Webhook) {
    setNotice({ id: webhook.id, text: t('testing'), bad: false });
    const response = await fetch(`/api/webhooks/${webhook.id}/test`, { method: 'POST' }).catch(() => null);
    const body = (await response?.json().catch(() => ({}))) as { delivered?: boolean; error?: string | null } | undefined;
    setNotice({
      id: webhook.id,
      text: body?.delivered ? t('testSent') : t('testFailed', { error: body?.error ?? tCommon('genericError') }),
      bad: !body?.delivered,
    });
    if (log?.id === webhook.id) void loadLog(webhook.id);
    router.refresh();
  }

  async function redeliver(webhookId: string, deliveryId: string) {
    await fetch(`/api/webhook-deliveries/${deliveryId}/redeliver`, { method: 'POST' }).catch(() => null);
    void loadLog(webhookId);
    router.refresh();
  }

  async function remove(webhook: Webhook) {
    const ok = await confirm({
      title: t('removeConfirm', { name: webhook.name }),
      body: t('removeConfirmBody'),
      confirmLabel: t('remove'),
      danger: true,
    });
    if (!ok) return;
    await fetch(`/api/webhooks/${webhook.id}`, { method: 'DELETE' }).catch(() => null);
    router.refresh();
  }

  return (
    <div className="space-y-6">
      {secret && (
        <section className="card space-y-2 border-amber-200 bg-amber-50 p-4" role="status">
          <h2 className="text-[15px] font-semibold text-amber-900">{t('secretTitle')}</h2>
          <p className="text-sm text-amber-900">{t('secretHint')}</p>
          <code className="block break-all rounded-lg bg-white px-3 py-2 font-mono text-xs text-slate-900">{secret.value}</code>
          <button type="button" className="btn-secondary" onClick={() => setSecret(null)}>
            {t('secretDone')}
          </button>
        </section>
      )}

      <section className="card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
          <div>
            <h2 className="text-[15px] font-semibold text-slate-900">{t('listTitle')}</h2>
            <p className="text-xs text-slate-500">{t('listHint')}</p>
          </div>
          <button type="button" className="btn-primary" onClick={() => setOpen(true)}>
            {t('add')}
          </button>
        </div>

        {webhooks.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-slate-500">{t('none')}</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {webhooks.map((webhook) => (
              <li key={webhook.id} className="space-y-2 px-4 py-3">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-slate-900">
                      {webhook.name}
                      {webhook.viaApi && <span className="ms-2 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">{t('viaApi')}</span>}
                    </span>
                    <span className="block truncate font-mono text-xs text-slate-500">{webhook.url}</span>
                    <span className={`block truncate text-xs ${webhook.lastError ? 'text-red-600' : 'text-slate-500'}`}>
                      {webhook.lastError ?? (webhook.lastSent ? t('lastSent', { when: webhook.lastSent }) : t('never'))}
                    </span>
                  </span>
                  <label className="flex items-center gap-2 text-xs font-semibold text-slate-700">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-slate-300 text-brand-500 focus:ring-brand-500"
                      checked={webhook.enabled}
                      onChange={() => void patch(webhook, { enabled: !webhook.enabled })}
                    />
                    {t('on')}
                  </label>
                  <button type="button" className="btn-secondary px-3 py-1 text-xs" onClick={() => void test(webhook)}>
                    {t('test')}
                  </button>
                  <button
                    type="button"
                    className="btn-secondary px-3 py-1 text-xs"
                    aria-expanded={log?.id === webhook.id}
                    onClick={() => (log?.id === webhook.id ? setLog(null) : void loadLog(webhook.id))}
                  >
                    {t('deliveries')}
                  </button>
                  <button type="button" className="btn-ghost px-2 py-1 text-xs hover:text-red-600" onClick={() => void remove(webhook)}>
                    {t('remove')}
                  </button>
                </div>
                {notice?.id === webhook.id && (
                  <p className={`rounded-lg px-3 py-1.5 text-xs ${notice.bad ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`} role="status">
                    {notice.text}
                  </p>
                )}
                <div className="flex flex-wrap gap-1.5">
                  {EVENTS.map((event) => {
                    const on = webhook.events.includes(event);
                    return (
                      <button
                        key={event}
                        type="button"
                        aria-pressed={on}
                        disabled={on && webhook.events.length === 1}
                        className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                          on ? 'bg-brand-50 text-brand-700 ring-1 ring-brand-200' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                        }`}
                        onClick={() => void patch(webhook, { events: toggle(webhook.events, event) })}
                      >
                        {t(`event_${key(event)}`)}
                      </button>
                    );
                  })}
                </div>
                {log?.id === webhook.id && (
                  <div className="rounded-lg border border-slate-200">
                    {log.deliveries === null ? (
                      <p className="px-3 py-3 text-xs text-slate-500">{tCommon('working')}</p>
                    ) : log.deliveries.length === 0 ? (
                      <p className="px-3 py-3 text-xs text-slate-500">{t('noDeliveries')}</p>
                    ) : (
                      <div className="scroll-x">
                        <table className="data-table w-full text-start text-xs">
                          <caption className="sr-only">{t('deliveries')}</caption>
                          <thead>
                            <tr>
                              <th scope="col" className="px-3 py-2 font-semibold">{t('colWhen')}</th>
                              <th scope="col" className="px-3 py-2 font-semibold">{t('colEvent')}</th>
                              <th scope="col" className="px-3 py-2 font-semibold">{t('colResult')}</th>
                              <th scope="col" className="px-3 py-2"><span className="sr-only">{t('redeliver')}</span></th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {log.deliveries.map((delivery) => (
                              <tr key={delivery.id}>
                                <td className="whitespace-nowrap px-3 py-2 text-slate-600">{new Date(delivery.createdAt).toLocaleString()}</td>
                                <td className="whitespace-nowrap px-3 py-2 font-mono text-slate-700">{delivery.event}</td>
                                <td className="px-3 py-2">
                                  <span
                                    className={`font-semibold ${
                                      delivery.status === 'delivered' ? 'text-emerald-700' : delivery.status === 'failed' ? 'text-red-700' : 'text-amber-700'
                                    }`}
                                  >
                                    {t(`status_${delivery.status}`, { attempts: delivery.attempts })}
                                  </span>
                                  {delivery.error && <span className="block text-slate-500">{delivery.error}</span>}
                                </td>
                                <td className="px-3 py-2 text-end">
                                  <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={() => void redeliver(webhook.id, delivery.id)}>
                                    {t('redeliver')}
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card space-y-2 p-4 text-sm text-slate-700">
        <h2 className="text-[15px] font-semibold text-slate-900">{t('howTitle')}</h2>
        <p>{t('howBody')}</p>
        <pre className="scroll-x rounded-lg bg-slate-50 px-3 py-2 font-mono text-xs text-slate-800">{`X-MSP-Event: post.published
X-MSP-Delivery: <id>
X-MSP-Timestamp: <unix seconds>
X-MSP-Signature: sha256=HMAC_SHA256(secret, "<timestamp>.<body>")`}</pre>
        <p>{t('howRetries')}</p>
        <p>{t('howZapier')}</p>
      </section>

      <Dialog
        open={open}
        title={t('add')}
        onClose={close}
        closeLabel={tCommon('close')}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={close}>
              {tCommon('cancel')}
            </button>
            <button type="button" className="btn-primary" disabled={pending || !name.trim() || !url.trim() || events.length === 0} onClick={() => void add()}>
              {pending ? tCommon('working') : t('add')}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          {error && (
            <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}
          <label className="block text-sm">
            <span className="label">{t('name')}</span>
            <input className="input" maxLength={60} placeholder={t('namePlaceholder')} value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <label className="block text-sm">
            <span className="label">{t('url')}</span>
            <input className="input font-mono text-xs" type="url" placeholder="https://example.com/hooks/social" value={url} onChange={(event) => setUrl(event.target.value)} />
            <span className="hint">{t('urlHint')}</span>
          </label>
          <fieldset>
            <legend className="label">{t('events')}</legend>
            <div className="flex flex-wrap gap-1.5">
              {EVENTS.map((event) => (
                <button
                  key={event}
                  type="button"
                  aria-pressed={events.includes(event)}
                  className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                    events.includes(event) ? 'bg-brand-500 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                  onClick={() => setEvents(toggle(events, event))}
                >
                  {t(`event_${key(event)}`)}
                </button>
              ))}
            </div>
          </fieldset>
        </div>
      </Dialog>
    </div>
  );
}
