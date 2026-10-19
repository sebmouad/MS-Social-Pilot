'use client';

import { useId, useState } from 'react';
import { Button } from '@/components/Button';
import { FieldError, useFormValidation } from '@/components/FormValidation';
import { ModalDialog } from '@/components/ModalDialog';
import { RouteNotice } from '@/components/RouteNotice';
import type { AdsNeutralOperation, AdsOperationInput, AdsOperationSupport, AdsOpsLimits } from '@/modules/ads/management/types';
import { budgetFractionDigits, formatBudgetMinor, parseBudgetAmount } from '@/modules/ads/ui/budget';

type Level = 'campaign' | 'adset' | 'ad';
type Detail = {
  name: string;
  currency: string | null;
  totals: { spend: number; impressions: number; clicks: number; cpc: number | null; ctr: number | null; cpm: number | null };
  daily: Array<{ date: string; spend: number; impressions: number; clicks: number }>;
  live: { available: boolean; configuredStatus?: string | null; effectiveStatus?: string | null };
  management: { available: boolean; canManage: boolean; operations: AdsOperationSupport[] };
};
type Capabilities = { canManage: boolean; canListCreatives?: boolean; operations: AdsOperationSupport[]; limits?: AdsOpsLimits };
type Creative = { id: string; name: string | null; title: string | null; body: string | null };
type Pending = {
  operation: AdsNeutralOperation;
  requestId: string;
  confirmation: string;
  spendChanging: boolean;
  irreversible: boolean;
  blockedByOpenChange: boolean | null;
  summary: string;
  feedback?: string;
};
type Outcome = { tone: 'ok' | 'error' | 'unknown'; text: string; key: string };

const LEVEL_WORD: Record<Level, string> = { campaign: 'campaign', adset: 'ad set', ad: 'ad' };
const number = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
const input = (support: AdsOperationSupport | undefined, name: AdsOperationInput['name']) => support?.inputs?.find(item => item.name === name);

export function ObjectManager({ adAccountId, level, objectId, name }: { adAccountId: string; level: Level; objectId: string; name: string }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);
  const [operationBlocked, setOperationBlocked] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [pendingDialogOpen, setPendingDialogOpen] = useState(false);
  const [budgetKind, setBudgetKind] = useState<'daily' | 'lifetime'>('daily');
  const [budget, setBudget] = useState('');
  const [newName, setNewName] = useState(name);
  const [creatives, setCreatives] = useState<Creative[] | null>(null);
  const [creativeId, setCreativeId] = useState('');
  const validation = useFormValidation();

  const supports = (capabilities?.operations ?? detail?.management.operations ?? []).filter(operation => operation.id !== 'campaign.create' && operation.id !== 'adset.create');
  const canManage = capabilities?.canManage ?? detail?.management.canManage ?? false;
  const limits = capabilities?.limits;
  const supportFor = (opId: string) => supports.find(item => item.id === opId && item.objectTypes.includes(level));

  async function toggle() {
    if (open) { setOpen(false); return; }
    setOpen(true); setLoadError(''); if (!pending) setOperationBlocked(false); setBusy(true);
    try {
      const params = new URLSearchParams({ accountId: adAccountId, level, objectId });
      const capabilityParams = new URLSearchParams({ view: 'capabilities', adAccountId });
      const [detailResponse, capabilityResponse] = await Promise.all([
        fetch(`/api/ads/directory?${params}`),
        fetch(`/api/ads/management?${capabilityParams}`),
      ]);
      const detailPayload = await detailResponse.json().catch(() => ({})) as Detail & { error?: string };
      if (!detailResponse.ok) throw new Error(detailPayload.error || 'The details could not be loaded.');
      setDetail(detailPayload);
      if (capabilityResponse.ok) {
        const capabilityPayload = await capabilityResponse.json().catch(() => null) as Capabilities | null;
        if (capabilityPayload && Array.isArray(capabilityPayload.operations)) setCapabilities(capabilityPayload);
      }
    } catch (error) { setLoadError(error instanceof Error ? error.message : 'The details could not be loaded.'); }
    finally { setBusy(false); }
  }

  async function preview(operation: AdsNeutralOperation, support: AdsOperationSupport, summary: string) {
    setBusy(true); setOutcome(null); validation.clearAll();
    try {
      const response = await fetch('/api/ads/management', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'preview', adAccountId, operation }) });
      const payload = await response.json().catch(() => ({})) as { error?: string; confirmation?: string; spendChanging?: boolean; irreversible?: boolean; blockedByOpenChange?: boolean | null };
      if (!response.ok || typeof payload.confirmation !== 'string' || !payload.confirmation) throw new Error(payload.error || 'This change could not be prepared.');
      const requestId = globalThis.crypto.randomUUID();
      const blockedByOpenChange = payload.blockedByOpenChange === true ? true : payload.blockedByOpenChange === false ? false : null;
      if (blockedByOpenChange !== false) setOperationBlocked(true);
      setPendingDialogOpen(true);
      setPending({ operation, requestId, confirmation: payload.confirmation, spendChanging: payload.spendChanging === true || support.spendChanging,
        irreversible: payload.irreversible === true || support.irreversible === true,
        blockedByOpenChange,
        summary });
    } catch (error) { setOutcome({ tone: 'error', key: String(Date.now()), text: error instanceof Error ? error.message : 'This change could not be prepared.' }); }
    finally { setBusy(false); }
  }

  async function apply() {
    if (!pending || pending.blockedByOpenChange !== false) return;
    setBusy(true);
    try {
      const response = await fetch('/api/ads/management', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'apply', adAccountId, operation: pending.operation, confirmation: pending.confirmation, requestId: pending.requestId }) });
      const payload = await response.json().catch(() => null) as { outcome?: string; message?: string; warning?: string; error?: string; status?: string; terminal?: boolean; replay?: boolean } | null;
      if (response.ok && payload?.outcome === 'succeeded') {
        setOutcome({ tone: 'ok', key: String(Date.now()), text: payload.warning ?? 'Change applied.' });
        setPending(null);
        setPendingDialogOpen(false);
        setOperationBlocked(false);
      } else if (response.ok && payload?.outcome === 'rejected') {
        const terminalReplay = payload.terminal === true && payload.replay === true && payload.status === 'resolved_not_applied';
        setOutcome({ tone: 'error', key: String(Date.now()), text: terminalReplay ? 'Your review confirmed that the previous change was not applied. You can prepare a new change.' : payload.message ?? 'The change was not applied. Review it before submitting a new request.' });
        setPending(null);
        setPendingDialogOpen(false);
        setOperationBlocked(false);
      } else {
        setPending(current => current ? { ...current, feedback: payload?.message ?? payload?.error ?? 'The result is unknown. The same request can be checked again safely.' } : current);
        setOperationBlocked(true);
        setPendingDialogOpen(false);
      }
    } catch {
      setPending(current => current ? { ...current, feedback: 'The result could not be confirmed. Retry uses the same request ID, so it cannot create a second change.' } : current);
      setOperationBlocked(true);
      setPendingDialogOpen(false);
    } finally { setBusy(false); }
  }

  function submitBudget(event: React.FormEvent<HTMLFormElement>, support: AdsOperationSupport, availableKinds: readonly ('daily' | 'lifetime')[]) {
    event.preventDefault();
    const minor = parseBudgetAmount(budget, detail?.currency ?? null);
    const errors: Record<string, string> = minor === null
      ? { budget: `Enter a valid amount${detail?.currency ? ` in ${detail.currency}` : ''} with up to ${budgetFractionDigits(detail?.currency ?? null)} decimal places.` }
      : limits && minor > limits.maxBudgetMinor
        ? { budget: `Enter an amount no higher than ${formatBudgetMinor(limits.maxBudgetMinor, detail?.currency ?? null)}.` }
        : {};
    if (!validation.validate(event.currentTarget, errors)) return;
    if (minor === null) return;
    const amount = formatBudgetMinor(minor, detail?.currency ?? null);
    const kind = availableKinds.includes(budgetKind) ? budgetKind : availableKinds[0];
    if (!kind) return;
    void preview({ type: 'budget.set', objectType: level as 'campaign' | 'adset', objectId, budget: { kind, minor } }, support, `Set the ${kind} budget to ${amount}.`);
  }
  function submitRename(event: React.FormEvent<HTMLFormElement>, support: AdsOperationSupport) {
    event.preventDefault();
    const value = newName.trim();
    const errors: Record<string, string> = !value ? { name: 'Enter a name.' }
      : limits && value.length > limits.nameMaxCharacters ? { name: `Keep the name to ${limits.nameMaxCharacters} characters or fewer.` }
        : {};
    if (!validation.validate(event.currentTarget, errors)) return;
    void preview({ type: 'rename', objectType: level, objectId, name: value }, support, `Rename this ${LEVEL_WORD[level]} to “${value}”.`);
  }
  async function loadCreatives() {
    setBusy(true); setOutcome(null);
    try {
      const params = new URLSearchParams({ view: 'creatives', adAccountId });
      const response = await fetch(`/api/ads/management?${params}`);
      const payload = await response.json().catch(() => ({})) as { error?: string; items?: Creative[] };
      if (!response.ok || !payload.items) throw new Error(payload.error || 'Creatives could not be loaded.');
      setCreatives(payload.items);
    } catch (error) { setOutcome({ tone: 'error', key: String(Date.now()), text: error instanceof Error ? error.message : 'Creatives could not be loaded.' }); }
    finally { setBusy(false); }
  }

  const statusSupport = supportFor('status.set');
  const budgetSupport = supportFor('budget.set');
  const renameSupport = supportFor('rename');
  const creativeSupport = supportFor('creative.assign');
  const deleteSupport = supportFor('delete');
  const statusInput = input(statusSupport, 'status');
  const budgetInput = input(budgetSupport, 'budget');
  const nameInput = input(renameSupport, 'name');
  const creativeInput = input(creativeSupport, 'creativeId');
  const budgetFieldProps = validation.fieldProps('budget');
  const nameFieldProps = validation.fieldProps('name');
  const creativeFieldProps = validation.fieldProps('creativeId');

  return <div className="ads-object-manager">
    <Button aria-expanded={open} aria-controls={`${id}-panel`} onClick={() => void toggle()} disabled={busy && !open}>{open ? 'Close' : 'Details'}</Button>
    {open ? <div id={`${id}-panel`} className="ads-object-manager__panel">
      {busy && !detail ? <p role="status">Loading details…</p> : null}
      {loadError ? <RouteNotice error className="ui-error" focusKey={loadError}>{loadError}</RouteNotice> : null}
      {detail ? <>
        <dl className="ads-compare-grid"><div><dt>Spend</dt><dd>{detail.currency ? `${detail.currency} ` : ''}{number.format(detail.totals.spend)}</dd></div><div><dt>Impressions</dt><dd>{number.format(detail.totals.impressions)}</dd></div><div><dt>Clicks</dt><dd>{number.format(detail.totals.clicks)}</dd></div><div><dt>Cost per click</dt><dd>{detail.totals.cpc === null ? 'Unknown' : number.format(detail.totals.cpc)}</dd></div><div><dt>Click-through rate</dt><dd>{detail.totals.ctr === null ? 'Unknown' : `${number.format(detail.totals.ctr)}%`}</dd></div><div><dt>Cost per 1,000 views</dt><dd>{detail.totals.cpm === null ? 'Unknown' : number.format(detail.totals.cpm)}</dd></div></dl>
        <details><summary>Daily figures</summary><ul>{detail.daily.map(day => <li key={day.date}>{day.date} · {detail.currency ? `${detail.currency} ` : ''}{number.format(day.spend)} · {number.format(day.impressions)} impressions · {number.format(day.clicks)} clicks</li>)}</ul></details>
        <p className="small-note">{detail.live.available ? `Current status: ${detail.live.configuredStatus ?? 'unknown'} · delivery: ${detail.live.effectiveStatus ?? 'unknown'}` : 'Current status could not be checked. Showing stored reports only.'}</p>
        {!canManage || !supports.length ? <p className="small-note">You can view this {LEVEL_WORD[level]}. Changes are not available for your access or this account.</p> : operationBlocked ? <p className="small-note">Changes are paused for this object until its open change is reviewed. <a href="/ads/objects#changes">Open change history</a>, then close and reopen Details to check again.</p> : <>
          {statusSupport && statusInput?.kind === 'choice' ? <div className="ads-object-manager__row">{statusInput.options.map(option => {
            if (option.value !== 'paused' && option.value !== 'active') return null;
            const status = option.value as 'paused' | 'active';
            return <Button key={status} disabled={busy} onClick={() => void preview({ type: 'status.set', objectType: level, objectId, status }, statusSupport, `${option.label} this ${LEVEL_WORD[level]}.`)}>{option.label}</Button>;
          })}</div> : null}
          {budgetSupport && budgetInput?.kind === 'money-minor' && budgetInput.budgetKinds.length ? <form className="ads-object-manager__row" onSubmit={event => submitBudget(event, budgetSupport, budgetInput.budgetKinds)} noValidate>
            <label><span className="sr-only">Budget period</span><select value={budgetInput.budgetKinds.includes(budgetKind) ? budgetKind : budgetInput.budgetKinds[0]} onChange={event => setBudgetKind(event.target.value as 'daily' | 'lifetime')} disabled={busy}>{budgetInput.budgetKinds.map(kind => <option key={kind} value={kind}>{kind === 'daily' ? 'Daily' : 'Lifetime'}</option>)}</select></label>
            <label htmlFor={budgetFieldProps.id}><span className="sr-only">New budget{detail.currency ? ` in ${detail.currency}` : ''}</span><input {...budgetFieldProps} name="budget" aria-label={`New budget${detail.currency ? ` in ${detail.currency}` : ''}`} inputMode="decimal" value={budget} onChange={event => { setBudget(event.target.value); validation.clear('budget'); }} placeholder={detail.currency ?? 'Amount'} required disabled={busy} /></label>
            <FieldError {...validation.errorProps('budget')} />
            <Button type="submit" disabled={busy}>{budgetSupport.label}</Button>
            {limits ? <p className="small-note">Maximum per change: {formatBudgetMinor(limits.maxBudgetMinor, detail.currency)}.</p> : null}
          </form> : null}
          {renameSupport && nameInput?.kind === 'text' ? <form className="ads-object-manager__row" onSubmit={event => submitRename(event, renameSupport)} noValidate>
            <label htmlFor={nameFieldProps.id}><span className="sr-only">New name</span><input {...nameFieldProps} name="name" aria-label="New name" value={newName} onChange={event => { setNewName(event.target.value); validation.clear('name'); }} maxLength={limits?.nameMaxCharacters} required disabled={busy} /></label>
            <FieldError {...validation.errorProps('name')} />
            <Button type="submit" disabled={busy}>{renameSupport.label}</Button>
          </form> : null}
          {creativeSupport && creativeInput?.kind === 'creative-ref' && capabilities?.canListCreatives ? <div className="ads-object-manager__row">
            {creatives === null ? <Button disabled={busy} onClick={() => void loadCreatives()}>Choose a creative</Button> : creatives.length === 0 ? <p className="small-note">No creatives are available in this account.</p> : <>
              <label htmlFor={creativeFieldProps.id}><span className="sr-only">Creative</span><select {...creativeFieldProps} name="creativeId" aria-label="Creative" value={creativeId} onChange={event => { setCreativeId(event.target.value); validation.clear('creativeId'); }} disabled={busy}><option value="">Choose a creative</option>{creatives.map(item => <option key={item.id} value={item.id}>{item.name || item.title || item.id}</option>)}</select></label>
              <FieldError {...validation.errorProps('creativeId')} />
              <Button disabled={busy || !creativeId} onClick={() => void preview({ type: 'creative.assign', objectType: 'ad', objectId, creativeId }, creativeSupport, 'Replace this ad’s creative with the one you chose.')}>{creativeSupport.label}</Button>
            </>}
          </div> : null}
          {deleteSupport ? <div className="ads-object-manager__row"><Button variant="danger" disabled={busy} onClick={() => void preview({ type: 'delete', objectType: level, objectId }, deleteSupport, `Delete this ${LEVEL_WORD[level]}.`)}>{deleteSupport.label}…</Button></div> : null}
        </>}
      </> : null}
      {outcome ? <><RouteNotice error={outcome.tone !== 'ok'} className={outcome.tone === 'ok' ? 'small-note' : 'ui-error'} focusKey={outcome.key}>{outcome.text}</RouteNotice>{outcome.tone === 'unknown' ? <a href="/ads/objects#changes">Open change history</a> : null}</> : null}
    </div> : null}
    {pending && !pendingDialogOpen ? <div className="ads-object-manager__pending" role="region" aria-labelledby={`${id}-pending-title`}>
      <h3 id={`${id}-pending-title`}>Change result needs review</h3>
      <RouteNotice error className="ui-error" focusKey={pending.feedback ?? 'unknown-ads-change'}>{pending.feedback ?? 'The change result could not be confirmed. Its request ID is retained.'}</RouteNotice>
      <p className="small-note">Retry checks the same request ID and does not start a second change. Review the platform and change history before trying again.</p>
      <Button onClick={() => void apply()} disabled={busy || pending.blockedByOpenChange !== false}>{busy ? 'Checking…' : 'Try the same change again'}</Button>{' '}
      <a href="/ads/objects#changes">Open change history</a>
    </div> : null}
    {pending && pendingDialogOpen ? <ModalDialog className="ui-dialog" labelledBy={`${id}-title`} onDismiss={() => { if (!busy) { setPending(null); setPendingDialogOpen(false); } }} busy={busy}>
      <div className="ui-dialog__header"><div><h2 id={`${id}-title`}>Confirm this change</h2><p>{pending.summary}</p></div></div>
      <div className="ui-dialog__body">
        {pending.spendChanging ? <p role="note"><strong>This change can affect what you spend.</strong></p> : null}
        {pending.irreversible ? <p role="note"><strong>This action cannot be undone.</strong></p> : null}
        <p>{LEVEL_WORD[level]} · {name}</p>
        {pending.blockedByOpenChange === true ? <p role="alert">This object already has a change in progress. This action cannot be confirmed until that change is reviewed. <a href="/ads/objects#changes">Open change history</a>.</p> : null}
        {pending.blockedByOpenChange === null ? <p role="alert">The current change history could not be checked, so this action is paused. Check Ads change history before trying again. <a href="/ads/objects#changes">Open change history</a>.</p> : null}
        {pending.feedback ? <p role="alert" className="ui-error">{pending.feedback} <a href="/ads/objects#changes">Open change history</a>.</p> : null}
        {pending.blockedByOpenChange === false && !pending.feedback ? <p className="small-note">If the result is uncertain, this same request ID is retained for retry and the change stays on hold until it is reviewed.</p> : null}
      </div>
      <div className="ui-dialog__actions">
        <Button data-dialog-cancel onClick={() => { setPending(null); setPendingDialogOpen(false); }} disabled={busy}>Cancel</Button>
        <Button variant="primary" onClick={() => void apply()} disabled={busy || pending.blockedByOpenChange !== false}>{busy ? 'Applying…' : 'Confirm change'}</Button>
      </div>
    </ModalDialog> : null}
  </div>;
}
