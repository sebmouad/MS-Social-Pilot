'use client';

import { useId, useState } from 'react';
import { ModalDialog } from '@/components/ModalDialog';
import { budgetFractionDigits, formatBudgetMinor, parseBudgetAmount } from '../budget';

type Level = 'campaign' | 'adset' | 'ad';
type Support = { id: string; objectTypes: Level[]; spendChanging: boolean; label: string };
type Detail = { name: string; currency: string | null; totals: { spend: number; impressions: number; clicks: number; cpc: number | null; ctr: number | null; cpm: number | null }; daily: Array<{ date: string; spend: number; impressions: number; clicks: number }>; live: { available: boolean; configuredStatus?: string | null; effectiveStatus?: string | null }; management: { available: boolean; canManage: boolean; operations: Support[] } };
type Creative = { id: string; name: string | null; title: string | null; body: string | null };
type Operation = Record<string, unknown>;
type Pending = { operation: Operation; confirmation: string; spendChanging: boolean; summary: string };
type Outcome = { tone: 'ok' | 'error' | 'unknown'; text: string };

const LEVEL_WORD: Record<Level, string> = { campaign: 'campaign', adset: 'ad set', ad: 'ad' };
const number = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });

export function ObjectManager({ adAccountId, level, objectId, name }: { adAccountId: string; level: Level; objectId: string; name: string }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loadError, setLoadError] = useState('');
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [budgetKind, setBudgetKind] = useState<'daily' | 'lifetime'>('daily');
  const [budget, setBudget] = useState('');
  const [newName, setNewName] = useState(name);
  const [fieldError, setFieldError] = useState('');
  const [creatives, setCreatives] = useState<Creative[] | null>(null);
  const [creativeId, setCreativeId] = useState('');

  const ops = detail?.management.operations ?? [];
  const has = (opId: string) => ops.some(item => item.id === opId && item.objectTypes.includes(level));

  async function toggle() {
    if (open) { setOpen(false); return; }
    setOpen(true); setLoadError(''); setBusy(true);
    try {
      const response = await fetch(`/api/ads/directory?${new URLSearchParams({ accountId: adAccountId, level, objectId })}`);
      const payload = await response.json().catch(() => ({})) as Detail & { error?: string };
      if (!response.ok) throw new Error(payload.error || 'The details could not be loaded.');
      setDetail(payload);
    } catch (error) { setLoadError(error instanceof Error ? error.message : 'The details could not be loaded.'); }
    finally { setBusy(false); }
  }

  async function preview(operation: Operation, summary: string) {
    setBusy(true); setOutcome(null); setFieldError('');
    try {
      const response = await fetch('/api/ads/management', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'preview', adAccountId, operation }) });
      const payload = await response.json().catch(() => ({})) as { error?: string; confirmation?: string; spendChanging?: boolean };
      if (!response.ok || !payload.confirmation) throw new Error(payload.error || 'This change could not be prepared.');
      setPending({ operation, confirmation: payload.confirmation, spendChanging: payload.spendChanging === true, summary });
    } catch (error) { setOutcome({ tone: 'error', text: error instanceof Error ? error.message : 'This change could not be prepared.' }); }
    finally { setBusy(false); }
  }

  async function apply() {
    if (!pending) return;
    setBusy(true);
    try {
      const response = await fetch('/api/ads/management', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'apply', adAccountId, operation: pending.operation, confirmation: pending.confirmation }) });
      const payload = await response.json().catch(() => null) as { error?: string; outcome?: string; message?: string; warning?: string } | null;
      if (!response.ok || !payload) setOutcome({ tone: 'unknown', text: payload?.error || 'The result of this change is unknown. Do not repeat it. Check Ads change history before trying again.' });
      else if (payload.outcome === 'succeeded') setOutcome({ tone: 'ok', text: payload.warning ?? 'Change applied.' });
      else if (payload.outcome === 'rejected') setOutcome({ tone: 'error', text: payload.message ?? 'The change was not applied.' });
      else setOutcome({ tone: 'unknown', text: payload.message ?? 'The result of this change is unknown. Do not repeat it.' });
    } catch { setOutcome({ tone: 'unknown', text: 'The result of this change is unknown. Do not repeat it. Check Ads change history before trying again.' }); }
    finally { setBusy(false); setPending(null); }
  }

  function submitBudget(event: React.FormEvent) {
    event.preventDefault();
    const minor = parseBudgetAmount(budget, detail?.currency ?? null);
    if (minor === null) { setFieldError(`Enter a valid amount${detail?.currency ? ` in ${detail.currency}` : ''} with up to ${budgetFractionDigits(detail?.currency ?? null)} decimal places.`); return; }
    void preview({ type: 'budget.set', objectType: level, objectId, budget: { kind: budgetKind, minor } }, `Set the ${budgetKind} budget to ${formatBudgetMinor(minor, detail?.currency ?? null)}.`);
  }
  function submitRename(event: React.FormEvent) {
    event.preventDefault();
    const value = newName.trim();
    if (!value) { setFieldError('Enter a name.'); return; }
    void preview({ type: 'rename', objectType: level, objectId, name: value }, `Rename this ${LEVEL_WORD[level]} to "${value}".`);
  }
  async function loadCreatives() {
    setBusy(true); setOutcome(null);
    try {
      const response = await fetch(`/api/ads/management?${new URLSearchParams({ view: 'creatives', adAccountId })}`);
      const payload = await response.json().catch(() => ({})) as { error?: string; items?: Creative[] };
      if (!response.ok || !payload.items) throw new Error(payload.error || 'Creatives could not be loaded.');
      setCreatives(payload.items);
    } catch (error) { setOutcome({ tone: 'error', text: error instanceof Error ? error.message : 'Creatives could not be loaded.' }); }
    finally { setBusy(false); }
  }

  return <div className="ads-object-manager">
    <button type="button" aria-expanded={open} aria-controls={`${id}-panel`} onClick={() => void toggle()} disabled={busy && !open}>{open ? 'Close' : 'Details'}</button>
    {open ? <div id={`${id}-panel`} className="ads-object-manager__panel">
      {busy && !detail ? <p role="status">Loading details…</p> : null}
      {loadError ? <p role="alert" className="ui-error">{loadError}</p> : null}
      {detail ? <>
        <dl className="ads-compare-grid"><div><dt>Spend</dt><dd>{detail.currency ? `${detail.currency} ` : ''}{number.format(detail.totals.spend)}</dd></div><div><dt>Impressions</dt><dd>{number.format(detail.totals.impressions)}</dd></div><div><dt>Clicks</dt><dd>{number.format(detail.totals.clicks)}</dd></div><div><dt>Cost per click</dt><dd>{detail.totals.cpc === null ? 'Unknown' : number.format(detail.totals.cpc)}</dd></div><div><dt>Click-through rate</dt><dd>{detail.totals.ctr === null ? 'Unknown' : `${number.format(detail.totals.ctr)}%`}</dd></div><div><dt>Cost per 1,000 views</dt><dd>{detail.totals.cpm === null ? 'Unknown' : number.format(detail.totals.cpm)}</dd></div></dl>
        <details><summary>Daily figures</summary><ul>{detail.daily.map(day => <li key={day.date}>{day.date} · {detail.currency ? `${detail.currency} ` : ''}{number.format(day.spend)} · {number.format(day.impressions)} impressions · {number.format(day.clicks)} clicks</li>)}</ul></details>
        <p className="small-note">{detail.live.available ? `Current status: ${detail.live.configuredStatus ?? 'unknown'} · delivery: ${detail.live.effectiveStatus ?? 'unknown'}` : 'Current status could not be checked. Showing stored reports only.'}</p>
        {!detail.management.available ? <p className="small-note">You can view this {LEVEL_WORD[level]}. Change controls are currently unavailable.</p> : !detail.management.canManage || !ops.length ? <p className="small-note">You can view this {LEVEL_WORD[level]}. Changes are not available for your access or this account.</p> : <>
          {has('status.set') ? <div className="ads-object-manager__row">
            <button type="button" disabled={busy} onClick={() => void preview({ type: 'status.set', objectType: level, objectId, status: 'paused' }, `Pause this ${LEVEL_WORD[level]}.`)}>Pause</button>
            <button type="button" disabled={busy} onClick={() => void preview({ type: 'status.set', objectType: level, objectId, status: 'active' }, `Resume this ${LEVEL_WORD[level]}. It may start spending.`)}>Resume</button>
          </div> : null}
          {has('budget.set') ? <form className="ads-object-manager__row" onSubmit={submitBudget} noValidate>
            <label><span className="sr-only">Budget period</span><select value={budgetKind} onChange={event => setBudgetKind(event.target.value as 'daily' | 'lifetime')} disabled={busy}><option value="daily">Daily</option><option value="lifetime">Lifetime</option></select></label>
            <label><span className="sr-only">New budget{detail.currency ? ` in ${detail.currency}` : ''}</span><input inputMode="decimal" value={budget} onChange={event => setBudget(event.target.value)} placeholder={detail.currency ?? 'Amount'} disabled={busy} /></label>
            <button type="submit" disabled={busy}>Change budget</button>
          </form> : null}
          {has('rename') ? <form className="ads-object-manager__row" onSubmit={submitRename} noValidate>
            <label><span className="sr-only">New name</span><input value={newName} onChange={event => setNewName(event.target.value)} maxLength={100} disabled={busy} /></label>
            <button type="submit" disabled={busy}>Rename</button>
          </form> : null}
          {fieldError ? <p role="alert" className="ui-error">{fieldError}</p> : null}
          {has('creative.assign') ? <div className="ads-object-manager__row">
            {creatives === null ? <button type="button" disabled={busy} onClick={() => void loadCreatives()}>Choose a creative</button> : creatives.length === 0 ? <p className="small-note">No creatives are available in this account.</p> : <>
              <label><span className="sr-only">Creative</span><select value={creativeId} onChange={event => setCreativeId(event.target.value)} disabled={busy}><option value="">Choose a creative</option>{creatives.map(item => <option key={item.id} value={item.id}>{item.name || item.title || item.id}</option>)}</select></label>
              <button type="button" disabled={busy || !creativeId} onClick={() => void preview({ type: 'creative.assign', objectType: 'ad', objectId, creativeId }, 'Replace this ad’s creative with the one you chose.')}>Assign creative</button>
            </>}
          </div> : null}
          {has('delete') ? <div className="ads-object-manager__row"><button type="button" disabled={busy} onClick={() => void preview({ type: 'delete', objectType: level, objectId }, `Delete this ${LEVEL_WORD[level]}. This cannot be undone.`)}>Delete…</button></div> : null}
        </>}
      </> : null}
      {outcome ? <p role={outcome.tone === 'ok' ? 'status' : 'alert'} className={outcome.tone === 'ok' ? 'small-note' : 'ui-error'}>{outcome.text}{outcome.tone === 'unknown' ? ' ' : ''}{outcome.tone === 'unknown' ? <a href="/ads/objects#changes">Open change history</a> : null}</p> : null}
    </div> : null}
    {pending ? <ModalDialog className="ui-dialog" labelledBy={`${id}-title`} onDismiss={() => { if (!busy) setPending(null); }} busy={busy}>
      <div className="ui-dialog__header"><div><h2 id={`${id}-title`}>Confirm this change</h2><p>{pending.summary}</p></div></div>
      <div className="ui-dialog__body">
        {pending.spendChanging ? <p role="note"><strong>This change can affect what you spend.</strong></p> : null}
        <p>{LEVEL_WORD[level]} · {name}</p>
        <p className="small-note">If the result cannot be confirmed, the change is recorded and you will be asked to check it before making another.</p>
      </div>
      <div className="ui-dialog__actions"><button type="button" data-dialog-cancel onClick={() => setPending(null)} disabled={busy}>Cancel</button><button type="button" onClick={() => void apply()} disabled={busy}>{busy ? 'Applying…' : 'Confirm change'}</button></div>
    </ModalDialog> : null}
  </div>;
}
