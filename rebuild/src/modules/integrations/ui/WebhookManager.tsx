'use client';

import { useRef, useState } from 'react';
import { Button } from '@/components/Button';
import { FieldError, useFormValidation } from '@/components/FormValidation';
import ui from './integrations.module.css';
import { SecretReveal } from './SecretReveal';

type Hook = { id: string; name: string; urlDisplay: string; events: string[]; enabled: boolean; source: 'dashboard' | 'api_key'; lastError: string | null; lastSentAt: string | null; pending: number; failed: number };
type Delivery = { id: string; event: string; status: string; attempts: number; responseStatus: number | null; error: string | null; createdAt: string };
type Action = { id: string; kind: 'delete' | 'rotate' | 'redeliver' | 'test' | 'reveal' };
type Copy = Record<string, string>;
const fmt = (text: string, vars: Record<string, string | number>) => Object.entries(vars).reduce((out, [key, value]) => out.split(`{${key}}`).join(String(value)), text);

async function call(url: string, method: string, fallback: string, body?: unknown) {
  const response = await fetch(url, { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof result.error === 'string' ? result.error : fallback);
  return result;
}

export function WebhookManager({ initial, events, emitted, maxEndpoints, copy, locale }: { initial: Hook[]; events: string[]; emitted: string[]; maxEndpoints: number; copy: Copy; locale: string }) {
  const [hooks, setHooks] = useState(initial);
  const [name, setName] = useState(''); const [url, setUrl] = useState(''); const [chosen, setChosen] = useState<string[]>([]);
  const [busy, setBusy] = useState(false); const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [secret, setSecret] = useState<{ label: string; value: string; notice: string } | null>(null);
  const [confirming, setConfirming] = useState<Action | null>(null);
  const [open, setOpen] = useState<{ id: string; deliveries: Delivery[]; page: number; hasMore: boolean; loading: boolean; error: string } | null>(null);
  const inFlight = useRef(false);
  const validation = useFormValidation();
  const full = hooks.length >= maxEndpoints;
  const label = (ev: string) => copy[`event.${ev}`] ?? ev;
  const when = (iso: string) => new Date(iso).toLocaleString(locale);

  const reload = async () => { const result = await call('/api/webhooks', 'GET', copy.genericError!); setHooks(result.webhooks); };
  async function run(task: () => Promise<string | void>) {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setNotice(null);
    try { const text = await task(); if (text) setNotice({ tone: 'ok', text }); } catch (error) { setNotice({ tone: 'error', text: error instanceof Error ? error.message : copy.genericError! }); }
    finally { inFlight.current = false; setBusy(false); setConfirming(null); }
  }
  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!validation.validate(event.currentTarget, { ...(!name.trim() ? { name: copy.enterName! } : {}), ...(!/^https:\/\//i.test(url.trim()) ? { url: copy.enterAddress! } : {}), ...(!chosen.length ? { events: copy.chooseEvent! } : {}) })) return;
    await run(async () => {
      const result = await call('/api/webhooks', 'POST', copy.genericError!, { name: name.trim(), url: url.trim(), events: chosen, confirmation: `CREATE WEBHOOK ${name.trim()}` });
      setSecret({ label: copy.signingSecret!, value: result.secret, notice: result.secretNotice });
      setName(''); setUrl(''); setChosen([]); await reload();
      return copy.added;
    });
  }
  async function loadDeliveries(id: string, page: number) {
    setOpen(current => ({ id, deliveries: current?.id === id && page > 1 ? current.deliveries : [], page, hasMore: false, loading: true, error: '' }));
    try {
      const result = await call(`/api/webhooks/${id}/deliveries?page=${page}`, 'GET', copy.historyFailed!);
      setOpen(current => ({ id, deliveries: [...(current?.id === id && page > 1 ? current.deliveries : []), ...result.deliveries], page, hasMore: result.hasMore, loading: false, error: '' }));
    } catch (error) { setOpen({ id, deliveries: [], page, hasMore: false, loading: false, error: error instanceof Error ? error.message : copy.historyFailed! }); }
  }
  const act = (action: Action, task: () => Promise<string | void>) => confirming?.id === action.id && confirming.kind === action.kind ? run(task) : setConfirming(action);
  const asking = (id: string, kind: Action['kind']) => confirming?.id === id && confirming.kind === kind;

  return <>
    <form method="post" noValidate className={ui.form} onSubmit={create}>
      <div className={ui.fields}>
        <label className={ui.field}>{copy.name}<input name="name" required maxLength={60} value={name} disabled={busy || full} autoComplete="off" onChange={e => { setName(e.currentTarget.value); validation.clear('name'); }} placeholder={copy.namePlaceholder} {...validation.fieldProps('name')} /><FieldError {...validation.errorProps('name')} /></label>
        <label className={ui.field}>{copy.address}<input name="url" type="url" required maxLength={500} value={url} disabled={busy || full} autoComplete="off" onChange={e => { setUrl(e.currentTarget.value); validation.clear('url'); }} placeholder={copy.addressPlaceholder} {...validation.fieldProps('url')} /><FieldError {...validation.errorProps('url')} /></label>
      </div>
      <fieldset className={ui.group} aria-invalid={validation.errors.events ? true : undefined}><legend>{copy.eventsLegend}</legend>
        {events.map((ev, index) => <label key={ev} className={ui.check}><input type="checkbox" name="events" value={ev} checked={chosen.includes(ev)} disabled={busy || full} onChange={e => { setChosen(c => e.currentTarget.checked ? [...c, ev] : c.filter(x => x !== ev)); validation.clear('events'); }} {...(index === 0 ? validation.fieldProps('events') : {})} /><span>{label(ev)}{emitted.includes(ev) ? null : <small>{copy.notEmitted}</small>}</span></label>)}
      </fieldset><FieldError {...validation.errorProps('events')} />
      {full && <p className={ui.notice}>{fmt(copy.full!, { max: maxEndpoints })}</p>}
      <div className={ui['row-actions']}><Button type="submit" variant="primary" disabled={busy || full}>{busy ? copy.working : copy.add}</Button></div>
    </form>
    {secret && <SecretReveal label={secret.label} value={secret.value} notice={secret.notice} onDone={() => setSecret(null)} strings={{ secretHidden: copy.secretHidden!, show: copy.show!, hide: copy.hide!, copy: copy.copy!, copied: copy.copied!, copyFailed: copy.copyFailed!, savedIt: copy.savedIt! }} />}
    {notice && <p role={notice.tone === 'error' ? 'alert' : 'status'} className={notice.tone === 'error' ? ui.error : ui.notice}>{notice.text}</p>}
    <div className={ui['tbl-scroll']}><table style={{ width: '100%' }}><thead><tr><th>{copy.colWebhook}</th><th>{copy.colEvents}</th><th>{copy.colStatus}</th><th><span className="sr-only">{copy.colActions}</span></th></tr></thead><tbody>
      {hooks.map(hook => <tr key={hook.id}>
        <td><strong>{hook.name}</strong><br /><small>{hook.urlDisplay}{hook.source === 'api_key' ? ` · ${copy.addedByKey}` : ''}</small></td>
        <td>{hook.events.map(label).join(', ')}</td>
        <td>{hook.enabled ? copy.active : copy.paused}{hook.lastError ? <><br /><small>{fmt(copy.lastProblem!, { error: hook.lastError })}</small></> : hook.lastSentAt ? <><br /><small>{fmt(copy.lastSent!, { when: when(hook.lastSentAt) })}</small></> : null}{hook.pending || hook.failed ? <><br /><small>{fmt(copy.queueState!, { pending: hook.pending, failed: hook.failed })}</small></> : null}</td>
        <td><div className={ui['row-actions']}>
          <Button size="sm" disabled={busy} onClick={() => void run(async () => { await call(`/api/webhooks/${hook.id}`, 'PATCH', copy.genericError!, { enabled: !hook.enabled, confirmation: `UPDATE WEBHOOK ${hook.id}` }); await reload(); return hook.enabled ? copy.paused_done : copy.resumed_done; })}>{hook.enabled ? copy.pause : copy.resume}</Button>
          <Button size="sm" disabled={busy} onClick={() => void act({ id: hook.id, kind: 'test' }, async () => { const r = await call(`/api/webhooks/${hook.id}/test`, 'POST', copy.genericError!, { confirmation: `TEST WEBHOOK ${hook.id}` }); await reload(); return r.delivered ? copy.testOk : fmt(copy.testFailed!, { error: r.error ?? copy.noAnswer! }); })}>{asking(hook.id, 'test') ? copy.testConfirm : copy.test}</Button>
          <Button size="sm" disabled={busy} onClick={() => void loadDeliveries(hook.id, 1)}>{copy.history}</Button>
          <Button size="sm" disabled={busy} onClick={() => void act({ id: hook.id, kind: 'reveal' }, async () => { const r = await call(`/api/webhooks/${hook.id}/secret/reveal`, 'POST', copy.genericError!, { confirmation: `REVEAL WEBHOOK SECRET ${hook.id}` }); setSecret({ label: `${copy.signingSecret}: ${hook.name}`, value: r.secret, notice: r.secretNotice }); })}>{asking(hook.id, 'reveal') ? copy.revealConfirm : copy.reveal}</Button>
          <Button size="sm" disabled={busy} onClick={() => void act({ id: hook.id, kind: 'rotate' }, async () => { const r = await call(`/api/webhooks/${hook.id}/secret`, 'POST', copy.genericError!, { confirmation: `ROTATE WEBHOOK SECRET ${hook.id}` }); setSecret({ label: copy.newSigningSecret!, value: r.secret, notice: r.secretNotice }); })}>{asking(hook.id, 'rotate') ? copy.rotateConfirm : copy.rotate}</Button>
          <Button size="sm" variant="danger" disabled={busy} onClick={() => void act({ id: hook.id, kind: 'delete' }, async () => { await call(`/api/webhooks/${hook.id}`, 'DELETE', copy.genericError!, { confirmation: `DELETE WEBHOOK ${hook.id}` }); setOpen(o => o?.id === hook.id ? null : o); await reload(); return copy.deleted; })}>{asking(hook.id, 'delete') ? copy.delConfirm : copy.del}</Button>
          {confirming?.id === hook.id && <Button size="sm" variant="quiet" onClick={() => setConfirming(null)}>{copy.cancel}</Button>}
        </div></td>
      </tr>)}
      {!hooks.length && <tr><td colSpan={4}>{copy.empty}</td></tr>}
    </tbody></table></div>
    {open && <section aria-label={copy.historyTitle} className={ui.stack} style={{ marginTop: 18 }}>
      <h3>{copy.historyTitle}</h3>
      {open.error && <p role="alert" className={ui.error}>{open.error}</p>}
      <div className={ui['tbl-scroll']}><table style={{ width: '100%' }}><thead><tr><th>{copy.colWhen}</th><th>{copy.colEvent}</th><th>{copy.colResult}</th><th><span className="sr-only">{copy.colActions}</span></th></tr></thead><tbody>
        {open.deliveries.map(d => <tr key={d.id}><td>{when(d.createdAt)}</td><td>{label(d.event)}</td><td>{d.status === 'delivered' ? copy.delivered : d.status === 'pending' ? copy.retrying : copy.gaveUp} · {d.attempts} {d.attempts === 1 ? copy.attempt : copy.attempts}{d.error ? <><br /><small>{d.error}</small></> : null}</td>
          <td>{d.status !== 'pending' && <Button size="sm" disabled={busy} onClick={() => void act({ id: d.id, kind: 'redeliver' }, async () => { const r = await call(`/api/webhooks/${open.id}/deliveries/${d.id}`, 'POST', copy.genericError!, { confirmation: `REDELIVER WEBHOOK DELIVERY ${d.id}` }); await loadDeliveries(open.id, 1); await reload(); return r.delivered ? copy.againOk : fmt(copy.againFailed!, { error: r.error ?? copy.noAnswer! }); })}>{asking(d.id, 'redeliver') ? copy.againConfirm : copy.again}</Button>}</td></tr>)}
        {!open.loading && !open.deliveries.length && !open.error && <tr><td colSpan={4}>{copy.historyEmpty}</td></tr>}
        {open.loading && <tr><td colSpan={4}>{copy.loading}</td></tr>}
      </tbody></table></div>
      <div className={ui['row-actions']}>{open.hasMore && <Button size="sm" disabled={open.loading} onClick={() => void loadDeliveries(open.id, open.page + 1)}>{copy.older}</Button>}<Button size="sm" variant="quiet" onClick={() => setOpen(null)}>{copy.closeHistory}</Button></div>
    </section>}
  </>;
}
