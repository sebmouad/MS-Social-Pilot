'use client';

import { useState } from 'react';
import ui from '@/modules/integrations/ui/integrations.module.css';
import { SecretReveal } from '@/modules/integrations/ui/SecretReveal';
import { FieldError, useFormValidation } from '@/components/FormValidation';

type Hook = { id: string; name: string; urlDisplay: string; events: string[]; enabled: boolean; source: 'dashboard' | 'api_key'; lastError: string | null; lastSentAt: string | null; pending: number; failed: number };
type Delivery = { id: string; event: string; status: string; attempts: number; responseStatus: number | null; error: string | null; createdAt: string };
type Action = { id: string; kind: 'delete' | 'rotate' | 'redeliver' | 'test' };
const LABELS: Record<string, string> = { 'post.scheduled': 'Post scheduled', 'post.published': 'Post published', 'post.failed': 'Post failed', 'comment.received': 'Comment received', 'page.disconnected': 'Channel disconnected', 'report.ready': 'Report ready' };

async function call(url: string, method: string, body?: unknown) {
  const response = await fetch(url, { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error ?? 'That did not work. Try again.');
  return result;
}

export function WebhookManager({ initial, events, maxEndpoints }: { initial: Hook[]; events: string[]; maxEndpoints: number }) {
  const [hooks, setHooks] = useState(initial);
  const [name, setName] = useState(''); const [url, setUrl] = useState(''); const [chosen, setChosen] = useState<string[]>([]);
  const [busy, setBusy] = useState(false); const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [secret, setSecret] = useState<{ label: string; value: string; notice: string } | null>(null);
  const [confirming, setConfirming] = useState<Action | null>(null);
  const [open, setOpen] = useState<{ id: string; deliveries: Delivery[]; page: number; hasMore: boolean; loading: boolean; error: string } | null>(null);
  const validation = useFormValidation();
  const full = hooks.length >= maxEndpoints;

  const reload = async () => { const result = await call('/api/webhooks', 'GET'); setHooks(result.webhooks); };
  async function run(task: () => Promise<string | void>) {
    setBusy(true); setNotice(null);
    try { const text = await task(); if (text) setNotice({ tone: 'ok', text }); } catch (error) { setNotice({ tone: 'error', text: error instanceof Error ? error.message : 'That did not work. Try again.' }); }
    finally { setBusy(false); setConfirming(null); }
  }
  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!validation.validate(event.currentTarget, { ...(!name.trim() ? { name: 'Enter a name.' } : {}), ...(!/^https:\/\//i.test(url.trim()) ? { url: 'Enter a public address starting with https://.' } : {}), ...(!chosen.length ? { events: 'Choose at least one event.' } : {}) })) return;
    await run(async () => {
      const result = await call('/api/webhooks', 'POST', { name: name.trim(), url: url.trim(), events: chosen, confirmation: `CREATE WEBHOOK ${name.trim()}` });
      setSecret({ label: 'Signing secret', value: result.secret, notice: result.secretNotice });
      setName(''); setUrl(''); setChosen([]); await reload();
      return 'Webhook added.';
    });
  }
  async function loadDeliveries(id: string, page: number) {
    setOpen(current => ({ id, deliveries: current?.id === id && page > 1 ? current.deliveries : [], page, hasMore: false, loading: true, error: '' }));
    try {
      const result = await call(`/api/webhooks/${id}/deliveries?page=${page}`, 'GET');
      setOpen(current => ({ id, deliveries: [...(current?.id === id && page > 1 ? current.deliveries : []), ...result.deliveries], page, hasMore: result.hasMore, loading: false, error: '' }));
    } catch (error) { setOpen({ id, deliveries: [], page, hasMore: false, loading: false, error: error instanceof Error ? error.message : 'Deliveries could not be loaded.' }); }
  }
  const act = (action: Action, task: () => Promise<string | void>) => confirming?.id === action.id && confirming.kind === action.kind ? run(task) : setConfirming(action);

  return <>
    <form method="post" noValidate className={ui.form} onSubmit={create}>
      <div className={ui.fields}>
        <label className={ui.field}>Name<input name="name" required maxLength={60} value={name} disabled={busy || full} onChange={e => { setName(e.currentTarget.value); validation.clear('name'); }} placeholder="Zapier" {...validation.fieldProps('name')} /><FieldError {...validation.errorProps('name')} /></label>
        <label className={ui.field}>Address<input name="url" type="url" required maxLength={500} value={url} disabled={busy || full} onChange={e => { setUrl(e.currentTarget.value); validation.clear('url'); }} placeholder="https://hooks.example.com/..." {...validation.fieldProps('url')} /><FieldError {...validation.errorProps('url')} /></label>
      </div>
      <fieldset className={ui.group} aria-invalid={validation.errors.events ? true : undefined}><legend>Send me these events</legend>
        {events.map((ev, index) => <label key={ev} className={ui.check}><input type="checkbox" name="events" value={ev} checked={chosen.includes(ev)} disabled={busy || full} onChange={e => { setChosen(c => e.currentTarget.checked ? [...c, ev] : c.filter(x => x !== ev)); validation.clear('events'); }} {...(index === 0 ? validation.fieldProps('events') : {})} />{LABELS[ev] ?? ev}</label>)}
      </fieldset><FieldError {...validation.errorProps('events')} />
      {full && <p className={ui.notice}>This workspace has reached its limit of {maxEndpoints} webhooks. Remove one to add another.</p>}
      <div className={ui['row-actions']}><button type="submit" disabled={busy || full}>{busy ? 'Working...' : 'Add webhook'}</button></div>
    </form>
    {secret && <SecretReveal label={secret.label} value={secret.value} notice={secret.notice} onDone={() => setSecret(null)} />}
    {notice && <p role={notice.tone === 'error' ? 'alert' : 'status'} className={notice.tone === 'error' ? ui.error : ui.notice}>{notice.text}</p>}
    <div className={ui['tbl-scroll']}><table style={{ width: '100%' }}><thead><tr><th>Webhook</th><th>Events</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>
      {hooks.map(hook => <tr key={hook.id}>
        <td><strong>{hook.name}</strong><br /><small>{hook.urlDisplay}{hook.source === 'api_key' ? ' · added by an API key' : ''}</small></td>
        <td>{hook.events.map(e => LABELS[e] ?? e).join(', ')}</td>
        <td>{hook.enabled ? 'Active' : 'Paused'}{hook.lastError ? <><br /><small>Last problem: {hook.lastError}</small></> : hook.lastSentAt ? <><br /><small>Last sent {new Date(hook.lastSentAt).toLocaleString()}</small></> : null}{hook.pending || hook.failed ? <><br /><small>{hook.pending} waiting · {hook.failed} gave up</small></> : null}</td>
        <td><div className={ui['row-actions']}>
          <button type="button" disabled={busy} onClick={() => void run(async () => { await call(`/api/webhooks/${hook.id}`, 'PATCH', { enabled: !hook.enabled, confirmation: `UPDATE WEBHOOK ${hook.id}` }); await reload(); return hook.enabled ? 'Webhook paused.' : 'Webhook resumed.'; })}>{hook.enabled ? 'Pause' : 'Resume'}</button>
          <button type="button" disabled={busy} onClick={() => void act({ id: hook.id, kind: 'test' }, async () => { const r = await call(`/api/webhooks/${hook.id}/test`, 'POST', { confirmation: `TEST WEBHOOK ${hook.id}` }); await reload(); return r.delivered ? 'The receiver accepted the test.' : `The test did not arrive: ${r.error ?? 'no answer'}`; })}>{confirming?.id === hook.id && confirming.kind === 'test' ? 'Send test now' : 'Test'}</button>
          <button type="button" disabled={busy} onClick={() => void loadDeliveries(hook.id, 1)}>History</button>
          <button type="button" disabled={busy} onClick={() => void act({ id: hook.id, kind: 'rotate' }, async () => { const r = await call(`/api/webhooks/${hook.id}/secret`, 'POST', { confirmation: `ROTATE WEBHOOK SECRET ${hook.id}` }); setSecret({ label: 'New signing secret', value: r.secret, notice: r.secretNotice }); })}>{confirming?.id === hook.id && confirming.kind === 'rotate' ? 'Confirm: replace secret' : 'New secret'}</button>
          <button type="button" disabled={busy} onClick={() => void act({ id: hook.id, kind: 'delete' }, async () => { await call(`/api/webhooks/${hook.id}`, 'DELETE', { confirmation: `DELETE WEBHOOK ${hook.id}` }); setOpen(o => o?.id === hook.id ? null : o); await reload(); return 'Webhook deleted.'; })}>{confirming?.id === hook.id && confirming.kind === 'delete' ? 'Confirm: delete' : 'Delete'}</button>
          {confirming?.id === hook.id && <button type="button" onClick={() => setConfirming(null)}>Cancel</button>}
        </div></td>
      </tr>)}
      {!hooks.length && <tr><td colSpan={4}>No webhooks yet. Add an address above to receive events as they happen.</td></tr>}
    </tbody></table></div>
    {open && <section aria-label="Delivery history" className={ui.stack} style={{ marginTop: 18 }}>
      <h3>Delivery history</h3>
      {open.error && <p role="alert" className={ui.error}>{open.error}</p>}
      <div className={ui['tbl-scroll']}><table style={{ width: '100%' }}><thead><tr><th>When</th><th>Event</th><th>Result</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>
        {open.deliveries.map(d => <tr key={d.id}><td>{new Date(d.createdAt).toLocaleString()}</td><td>{LABELS[d.event] ?? d.event}</td><td>{d.status === 'delivered' ? 'Delivered' : d.status === 'pending' ? 'Waiting to retry' : 'Gave up'} · {d.attempts} {d.attempts === 1 ? 'attempt' : 'attempts'}{d.error ? <><br /><small>{d.error}</small></> : null}</td>
          <td>{d.status !== 'pending' && <button type="button" disabled={busy} onClick={() => void act({ id: d.id, kind: 'redeliver' }, async () => { const r = await call(`/api/webhooks/${open.id}/deliveries/${d.id}`, 'POST', { confirmation: `REDELIVER WEBHOOK DELIVERY ${d.id}` }); await loadDeliveries(open.id, 1); await reload(); return r.delivered ? 'Sent again and accepted.' : `Sent again, but it failed: ${r.error ?? 'no answer'}`; })}>{confirming?.id === d.id ? 'Confirm: send again' : 'Send again'}</button>}</td></tr>)}
        {!open.loading && !open.deliveries.length && !open.error && <tr><td colSpan={4}>Nothing has been sent to this webhook yet.</td></tr>}
        {open.loading && <tr><td colSpan={4}>Loading...</td></tr>}
      </tbody></table></div>
      <div className={ui['row-actions']}>{open.hasMore && <button type="button" disabled={open.loading} onClick={() => void loadDeliveries(open.id, open.page + 1)}>Show older</button>}<button type="button" onClick={() => setOpen(null)}>Close history</button></div>
    </section>}
  </>;
}
