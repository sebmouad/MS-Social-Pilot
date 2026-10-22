'use client';

import { useRef, useState } from 'react';
import { DataTable, Menu, ConfirmDialog, useToast } from '@/components';
import { Button } from '@/components/Button';
import { FieldError, useFormValidation } from '@/components/FormValidation';
import ui from './integrations.module.css';
import { SecretReveal } from './SecretReveal';

type Hook = { id: string; name: string; urlDisplay: string; events: string[]; enabled: boolean; source: 'dashboard' | 'api_key'; lastError: string | null; lastSentAt: string | null; pending: number; failed: number; labels?: { lastSentAt?: string } };
type Delivery = { id: string; event: string; status: string; attempts: number; responseStatus: number | null; error: string | null; createdAt: string; labels?: { createdAt?: string } };
type Action = { id: string; kind: 'delete' | 'rotate' | 'redeliver' | 'test' | 'reveal' };
type Copy = Record<string, string>;
const fmt = (text: string, vars: Record<string, string | number>) => Object.entries(vars).reduce((out, [key, value]) => out.split(`{${key}}`).join(String(value)), text);

async function call(url: string, method: string, fallback: string, body?: unknown) {
  const response = await fetch(url, { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof result.error === 'string' ? result.error : fallback);
  return result;
}

export function WebhookManager({ initial, events, emitted, maxEndpoints, copy, locale, nameMaxLength, urlMaxLength }: { nameMaxLength: number; urlMaxLength: number; initial: Hook[]; events: string[]; emitted: string[]; maxEndpoints: number; copy: Copy; locale: string }) {
  const [hooks, setHooks] = useState(initial);
  const [name, setName] = useState(''); const [url, setUrl] = useState(''); const [chosen, setChosen] = useState<string[]>([]);
  const [busy, setBusy] = useState(false); const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [secret, setSecret] = useState<{ label: string; value: string; notice: string } | null>(null);
  const [confirming, setConfirming] = useState<(Action & { task: () => Promise<string | void> }) | null>(null);
  const toast = useToast();
  const [open, setOpen] = useState<{ id: string; deliveries: Delivery[]; page: number; hasMore: boolean; loading: boolean; error: string } | null>(null);
  const inFlight = useRef(false);
  const historyGeneration = useRef(0);
  const validation = useFormValidation();
  const full = hooks.length >= maxEndpoints;
  const label = (ev: string) => copy[`event.${ev}`] ?? ev;

  const reload = async () => { try { const result = await call('/api/webhooks', 'GET', copy.genericError!); if (!Array.isArray(result.webhooks)) throw new Error(); setHooks(result.webhooks); } catch { toast.notify({ title: copy.loadFailed!, tone: 'error' }); } };
  const operation = useRef<Promise<string | null> | null>(null);
  function run(task: () => Promise<string | void>) {
    if (!operation.current) operation.current = runOnce(task).finally(() => { operation.current = null; });
    return operation.current;
  }
  async function runOnce(task: () => Promise<string | void>) {
    if (inFlight.current) return copy.genericError!;
    inFlight.current = true; setBusy(true); setNotice(null);
    try { const text = await task(); if (text) { setNotice({ tone: 'ok', text }); toast.notify({ title: text }); } return null; } catch (error) { const text = copy.genericError!; setNotice({ tone: 'error', text }); toast.notify({ title: text, tone: 'error' }); return text; }
    finally { inFlight.current = false; setBusy(false); }
  }
  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!validation.validate(event.currentTarget, { ...(!name.trim() ? { name: copy.enterName! } : {}), ...(!/^https:\/\//i.test(url.trim()) ? { url: copy.enterAddress! } : {}), ...(!chosen.length ? { events: copy.chooseEvent! } : {}) })) return;
    await run(async () => {
      const result = await call('/api/webhooks', 'POST', copy.genericError!, { name: name.trim(), url: url.trim(), events: chosen, confirmation: `CREATE WEBHOOK ${name.trim()}` });
      setSecret({ label: copy.signingSecret!, value: result.secret, notice: copy.secretNote! });
      setName(''); setUrl(''); setChosen([]); await reload();
      return copy.added;
    });
  }
  async function loadDeliveries(id: string, page: number) {
    const generation = ++historyGeneration.current;
    setOpen(current => ({ id, deliveries: current?.id === id && page > 1 ? current.deliveries : [], page, hasMore: false, loading: true, error: '' }));
    try {
      const result = await call(`/api/webhooks/${id}/deliveries?page=${page}`, 'GET', copy.historyFailed!);
      if (historyGeneration.current !== generation) return;
      setOpen(current => ({ id, deliveries: [...(current?.id === id && page > 1 ? current.deliveries : []), ...result.deliveries], page, hasMore: result.hasMore, loading: false, error: '' }));
    } catch (error) { if (historyGeneration.current !== generation) return; setOpen({ id, deliveries: [], page, hasMore: false, loading: false, error: error instanceof Error ? error.message : copy.historyFailed! }); }
  }
  const act = (action: Action, task: () => Promise<string | void>) => setConfirming({ ...action, task });

  return <>
    <form method="post" noValidate className={ui.form} onSubmit={create}>
      <div className={ui.fields}>
        <label className={ui.field}>{copy.name}<input name="name" required maxLength={nameMaxLength} value={name} disabled={busy || full} autoComplete="off" onChange={e => { setName(e.currentTarget.value); validation.clear('name'); }} placeholder={copy.namePlaceholder} {...validation.fieldProps('name')} /><FieldError {...validation.errorProps('name')} /></label>
        <label className={ui.field}>{copy.address}<input name="url" type="url" required maxLength={urlMaxLength} value={url} disabled={busy || full} autoComplete="off" onChange={e => { setUrl(e.currentTarget.value); validation.clear('url'); }} placeholder={copy.addressPlaceholder} {...validation.fieldProps('url')} /><FieldError {...validation.errorProps('url')} /></label>
      </div>
      <fieldset className={ui.group} aria-invalid={validation.errors.events ? true : undefined}><legend>{copy.eventsLegend}</legend>
        {events.map((ev, index) => <label key={ev} className={ui.check}><input type="checkbox" name="events" value={ev} checked={chosen.includes(ev)} disabled={busy || full} onChange={e => { setChosen(c => e.currentTarget.checked ? [...c, ev] : c.filter(x => x !== ev)); validation.clear('events'); }} {...(index === 0 ? validation.fieldProps('events') : {})} /><span>{label(ev)}{emitted.includes(ev) ? null : <small>{copy.notEmitted}</small>}</span></label>)}
      </fieldset><FieldError {...validation.errorProps('events')} />
      {full && <p className={ui.notice}>{fmt(copy.full!, { max: maxEndpoints })}</p>}
      <div className={ui['row-actions']}><Button type="submit" variant="primary" disabled={busy || full}>{busy ? copy.working : copy.add}</Button></div>
    </form>
    {secret && <SecretReveal key={secret.value} label={secret.label} value={secret.value} notice={secret.notice} onDone={() => setSecret(null)} strings={{ secretHidden: copy.secretHidden!, show: copy.show!, hide: copy.hide!, copy: copy.copy!, copied: copy.copied!, copyFailed: copy.copyFailed!, savedIt: copy.savedIt! }} />}
    {notice && <p role={notice.tone === 'error' ? 'alert' : 'status'} className={notice.tone === 'error' ? ui.error : ui.notice}>{notice.text}</p>}
    <DataTable caption={copy.title!} rows={hooks} rowKey={hook => hook.id} emptyMessage={copy.empty!} columns={[
      { key: 'webhook', label: copy.colWebhook!, render: hook => <><strong>{hook.name}</strong><br /><small>{hook.urlDisplay}</small></> },
      { key: 'events', label: copy.colEvents!, render: hook => hook.events.map(label).join(', ') },
      { key: 'status', label: copy.colStatus!, render: hook => <>{hook.enabled ? copy.active : copy.paused}{hook.lastSentAt && <small>{fmt(copy.lastSent!, { when: hook.labels?.lastSentAt ?? '' })}</small>}{Boolean(hook.pending || hook.failed) && <small>{fmt(copy.queueState!, { pending: hook.pending, failed: hook.failed })}</small>}</> },
      { key: 'actions', label: copy.colActions!, render: hook => <div className={ui['row-actions']}>
        <Button size="sm" disabled={busy} onClick={() => act({ id: hook.id, kind: 'test' }, async () => { const r = await call(`/api/webhooks/${hook.id}/test`, 'POST', copy.genericError!, { confirmation: `TEST WEBHOOK ${hook.id}` }); await reload(); if (!r.delivered) throw new Error(); return copy.testOk; })}>{copy.test}</Button>
        <Menu label={`${copy.colActions}: ${hook.name}`} items={[
          { key: 'toggle', label: hook.enabled ? copy.pause! : copy.resume!, disabled: busy, onSelect: () => void run(async () => { await call(`/api/webhooks/${hook.id}`, 'PATCH', copy.genericError!, { enabled: !hook.enabled, confirmation: `UPDATE WEBHOOK ${hook.id}` }); await reload(); return hook.enabled ? copy.paused_done : copy.resumed_done; }) },
          { key: 'history', label: copy.history!, disabled: busy, onSelect: () => void loadDeliveries(hook.id, 1) },
          { key: 'reveal', label: copy.reveal!, disabled: busy, onSelect: () => act({ id: hook.id, kind: 'reveal' }, async () => { const r = await call(`/api/webhooks/${hook.id}/secret/reveal`, 'POST', copy.genericError!, { confirmation: `REVEAL WEBHOOK SECRET ${hook.id}` }); setSecret({ label: `${copy.signingSecret}: ${hook.name}`, value: r.secret, notice: copy.secretNote! }); }) },
          { key: 'rotate', label: copy.rotate!, disabled: busy, onSelect: () => act({ id: hook.id, kind: 'rotate' }, async () => { const r = await call(`/api/webhooks/${hook.id}/secret`, 'POST', copy.genericError!, { confirmation: `ROTATE WEBHOOK SECRET ${hook.id}` }); setSecret({ label: `${copy.newSigningSecret}: ${hook.name}`, value: r.secret, notice: copy.rotateNote! }); }) },
          { key: 'delete', label: copy.del!, danger: true, disabled: busy, onSelect: () => act({ id: hook.id, kind: 'delete' }, async () => { await call(`/api/webhooks/${hook.id}`, 'DELETE', copy.genericError!, { confirmation: `DELETE WEBHOOK ${hook.id}` }); setOpen(o => o?.id === hook.id ? null : o); await reload(); return copy.deleted; }) },
        ]} />
      </div> },
    ]} />
    {confirming && <ConfirmDialog key={`${confirming.kind}:${confirming.id}`} open
      title={copy[confirming.kind === 'delete' ? 'del' : confirming.kind === 'redeliver' ? 'again' : confirming.kind]!}
      objectName={hooks.find(h => h.id === confirming.id)?.name ?? `${hooks.find(h => h.id === open?.id)?.name ?? copy.historyTitle} · ${confirming.id}`}
      consequence={copy[confirming.kind === 'delete' ? 'deleteNote' : confirming.kind === 'redeliver' ? 'againNote' : `${confirming.kind}Note`] ?? copy.confirmChange!}
      confirmLabel={copy[confirming.kind === 'delete' ? 'del' : confirming.kind === 'redeliver' ? 'again' : confirming.kind]!} cancelLabel={copy.cancel!} failureLabel={copy.genericError!}
      danger={confirming.kind === 'delete' || confirming.kind === 'rotate'} onClose={() => setConfirming(null)} onConfirm={() => run(confirming.task)} />}
    {open && <section aria-label={copy.historyTitle} className={ui.stack} style={{ marginTop: 18 }}>
      <h3>{copy.historyTitle}</h3>
      {open.error && <p role="alert" className={ui.error}>{open.error}</p>}
      <DataTable caption={copy.historyTitle!} rows={open.deliveries} rowKey={d => d.id} emptyMessage={open.loading ? copy.loading! : copy.historyEmpty!} columns={[
        { key: 'when', label: copy.colWhen!, render: d => d.labels?.createdAt ?? '' },
        { key: 'event', label: copy.colEvent!, render: d => label(d.event) },
        { key: 'result', label: copy.colResult!, render: d => <>{d.status === 'delivered' ? copy.delivered : d.status === 'pending' ? copy.retrying : copy.gaveUp} · {d.attempts} {d.attempts === 1 ? copy.attempt : copy.attempts}</> },
        { key: 'again', label: copy.colActions!, render: d => d.status !== 'pending' && <Button size="sm" disabled={busy} onClick={() => act({ id: d.id, kind: 'redeliver' }, async () => { const r = await call(`/api/webhooks/${open.id}/deliveries/${d.id}`, 'POST', copy.genericError!, { confirmation: `REDELIVER WEBHOOK DELIVERY ${d.id}` }); await loadDeliveries(open.id, 1); await reload(); if (!r.delivered) throw new Error(); return copy.againOk; })}>{copy.again}</Button> },
      ]} />
      <div className={ui['row-actions']}>{open.hasMore && <Button size="sm" disabled={open.loading} onClick={() => void loadDeliveries(open.id, open.page + 1)}>{copy.older}</Button>}<Button size="sm" variant="quiet" onClick={() => { historyGeneration.current++; setOpen(null); }}>{copy.closeHistory}</Button></div>
    </section>}
  </>;
}
