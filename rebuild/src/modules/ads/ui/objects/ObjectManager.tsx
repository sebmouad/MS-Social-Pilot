'use client';
import { useAdsMessage } from '@/modules/ads/ui/AdsCopyProvider';
import { useAdsText } from '@/modules/ads/ui/AdsCopyProvider';

import { useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import { patchObjectRow } from './row-state';
import { useToast } from '@/components/Toast';
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
  management: { available: boolean; canManage: boolean; needsReconnect?: boolean; operations: AdsOperationSupport[] };
};
type Capabilities = { canManage: boolean; needsReconnect?: boolean; canListCreatives?: boolean; operations: AdsOperationSupport[]; limits?: AdsOpsLimits };
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

const number = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
const input = (support: AdsOperationSupport | undefined, name: AdsOperationInput['name']) => support?.inputs?.find(item => item.name === name);

export function ObjectManager({ adAccountId, level, objectId, name }: { adAccountId: string; level: Level; objectId: string; name: string }) {
  const localize = useAdsMessage();
  const t = useAdsText();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);
  const [operationBlocked, setOperationBlocked] = useState(false);
  const [loadError, setLoadError] = useState('');
  const toast = useToast();
  const router = useRouter();
  const [outcome, storeOutcome] = useState<Outcome | null>(null);
  const setOutcome = (value: Outcome | null) => {
    storeOutcome(value);
    if (!value) return;
    if (value.tone === 'ok') toast.notify({ title: value.text, tone: 'success' });
    else toast.failed(value.text, () => window.location.assign('/ads/objects#changes'), t('text236'));
  };
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
  const needsReconnect = !canManage && (capabilities?.needsReconnect ?? detail?.management.needsReconnect ?? false);
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
      if (!detailResponse.ok) throw new Error(detailPayload.error || t('text237'));
      setDetail(detailPayload);
      if (capabilityResponse.ok) {
        const capabilityPayload = await capabilityResponse.json().catch(() => null) as Capabilities | null;
        if (capabilityPayload && Array.isArray(capabilityPayload.operations)) setCapabilities(capabilityPayload);
      }
    } catch (error) { setLoadError(error instanceof Error ? error.message : t('text237')); }
    finally { setBusy(false); }
  }

  async function preview(operation: AdsNeutralOperation, support: AdsOperationSupport, summary: string) {
    setBusy(true); setOutcome(null); validation.clearAll();
    try {
      const response = await fetch('/api/ads/management', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'preview', adAccountId, operation }) });
      const payload = await response.json().catch(() => ({})) as { error?: string; confirmation?: string; spendChanging?: boolean; irreversible?: boolean; blockedByOpenChange?: boolean | null };
      if (!response.ok || typeof payload.confirmation !== 'string' || !payload.confirmation) throw new Error(payload.error || t('text238'));
      const requestId = globalThis.crypto.randomUUID();
      const blockedByOpenChange = payload.blockedByOpenChange === true ? true : payload.blockedByOpenChange === false ? false : null;
      if (blockedByOpenChange !== false) setOperationBlocked(true);
      setPendingDialogOpen(true);
      setPending({ operation, requestId, confirmation: payload.confirmation, spendChanging: payload.spendChanging === true || support.spendChanging,
        irreversible: payload.irreversible === true || support.irreversible === true,
        blockedByOpenChange,
        summary });
    } catch (error) { setOutcome({ tone: 'error', key: String(Date.now()), text: error instanceof Error ? error.message : t('text238') }); }
    finally { setBusy(false); }
  }

  async function apply() {
    if (!pending || pending.blockedByOpenChange !== false) return;
    setBusy(true);
    try {
      const response = await fetch('/api/ads/management', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'apply', adAccountId, operation: pending.operation, confirmation: pending.confirmation, requestId: pending.requestId }) });
      const payload = await response.json().catch(() => null) as { outcome?: string; message?: string; warning?: string; error?: string; status?: string; terminal?: boolean; replay?: boolean } | null;
      if (response.ok && payload?.outcome === 'succeeded') {
        setOutcome({ tone: 'ok', key: String(Date.now()), text: payload.warning ?? t('text239') });
        const done = pending.operation;
        if (done.type === 'rename') {
          patchObjectRow(adAccountId, level, objectId, { name: done.name });
          setDetail(current => current ? { ...current, name: done.name } : current);
        } else if (done.type === 'status.set') {
          patchObjectRow(adAccountId, level, objectId, { status: done.status });
          setDetail(current => current ? { ...current, live: { ...current.live, configuredStatus: done.status } } : current);
        }
        router.refresh();
        setPending(null);
        setPendingDialogOpen(false);
        setOperationBlocked(false);
      } else if (response.ok && payload?.outcome === 'rejected') {
        const terminalReplay = payload.terminal === true && payload.replay === true && payload.status === 'resolved_not_applied';
        setOutcome({ tone: 'error', key: String(Date.now()), text: terminalReplay ? t('text240') : payload.message ?? t('text200') });
        setPending(null);
        setPendingDialogOpen(false);
        setOperationBlocked(false);
      } else {
        setPending(current => current ? { ...current, feedback: payload?.message ?? payload?.error ?? t('text241') } : current);
        setOperationBlocked(true);
        setPendingDialogOpen(false);
      }
    } catch {
      setPending(current => current ? { ...current, feedback: t('networkChangeHeld') } : current);
      setOperationBlocked(true);
      setPendingDialogOpen(false);
    } finally { setBusy(false); }
  }

  function submitBudget(event: React.FormEvent<HTMLFormElement>, support: AdsOperationSupport, availableKinds: readonly ('daily' | 'lifetime')[]) {
    event.preventDefault();
    const minor = parseBudgetAmount(budget, detail?.currency ?? null);
    const errors: Record<string, string> = minor === null
      ? { budget: t('text242', { value0: detail?.currency ? t('currencyDetail', { currency: detail.currency }) : '', value1: budgetFractionDigits(detail?.currency ?? null) }) }
      : limits && minor > limits.maxBudgetMinor
        ? { budget: t('text243', { value0: formatBudgetMinor(limits.maxBudgetMinor, detail?.currency ?? null) }) }
        : {};
    if (!validation.validate(event.currentTarget, errors)) return;
    if (minor === null) return;
    const amount = formatBudgetMinor(minor, detail?.currency ?? null);
    const kind = availableKinds.includes(budgetKind) ? budgetKind : availableKinds[0];
    if (!kind) return;
    void preview({ type: 'budget.set', objectType: level as 'campaign' | 'adset', objectId, budget: { kind, minor } }, support, t('text244', { value0: kind, value1: amount }));
  }
  function submitRename(event: React.FormEvent<HTMLFormElement>, support: AdsOperationSupport) {
    event.preventDefault();
    const value = newName.trim();
    const errors: Record<string, string> = !value ? { name: t('text245') }
      : limits && value.length > limits.nameMaxCharacters ? { name: t('text246', { value0: limits.nameMaxCharacters }) }
        : {};
    if (!validation.validate(event.currentTarget, errors)) return;
    void preview({ type: 'rename', objectType: level, objectId, name: value }, support, t('text247', { value0: t(level), value1: value }));
  }
  async function loadCreatives() {
    setBusy(true); setOutcome(null);
    try {
      const params = new URLSearchParams({ view: 'creatives', adAccountId });
      const response = await fetch(`/api/ads/management?${params}`);
      const payload = await response.json().catch(() => ({})) as { error?: string; items?: Creative[] };
      if (!response.ok || !payload.items) throw new Error(payload.error || t('text248'));
      setCreatives(payload.items);
    } catch (error) { setOutcome({ tone: 'error', key: String(Date.now()), text: error instanceof Error ? error.message : t('text248') }); }
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
    <Button aria-expanded={open} aria-controls={`${id}-panel`} onClick={() => void toggle()} disabled={busy && !open}>{open ? t('text091') : t('text092')}</Button>
    {open ? <div id={`${id}-panel`} className="ads-object-manager__panel">
      {busy && !detail ? <p role="status">{t('text093')}</p> : null}
      {loadError ? <RouteNotice error className="ui-error" focusKey={localize(loadError)}>{localize(loadError)}</RouteNotice> : null}
      {detail ? <>
        <dl className="ads-compare-grid"><div><dt>{t('text019')}</dt><dd>{detail.currency ? `${detail.currency} ` : ''}{number.format(detail.totals.spend)}</dd></div><div><dt>{t('text020')}</dt><dd>{number.format(detail.totals.impressions)}</dd></div><div><dt>{t('text022')}</dt><dd>{number.format(detail.totals.clicks)}</dd></div><div><dt>{t('text064')}</dt><dd>{detail.totals.cpc === null ? t('text094') : number.format(detail.totals.cpc)}</dd></div><div><dt>{t('text063')}</dt><dd>{detail.totals.ctr === null ? t('text094') : `${number.format(detail.totals.ctr)}%`}</dd></div><div><dt>{t('text065')}</dt><dd>{detail.totals.cpm === null ? t('text094') : number.format(detail.totals.cpm)}</dd></div></dl>
        <details><summary>{t('text095')}</summary><ul>{detail.daily.map(day => <li key={day.date}>{t('objectDailyLine', { date: day.date, currency: detail.currency ? `${detail.currency} ` : '', spend: number.format(day.spend), impressions: number.format(day.impressions), clicks: number.format(day.clicks) })}</li>)}</ul></details>
        <p className="small-note">{detail.live.available ? t('text249', { value0: detail.live.configuredStatus ?? t('text094'), value1: detail.live.effectiveStatus ?? t('text094') }) : t('text098')}</p>
        {needsReconnect ? <p className="small-note" role="note">{t('needsReconnectObject', { kind: t(level) })} <a href="/settings/connections">{t('needsReconnectAction')}</a></p>
          : !canManage || !supports.length ? <p className="small-note">{t('viewOnlyObject', { kind: t(level) })}</p> : operationBlocked ? <p className="small-note">{t('text101')}<a href="/ads/objects#changes">{t('text102')}</a>{t('text103')}</p> : <>
          {statusSupport && statusInput?.kind === 'choice' ? <div className="ads-object-manager__row">{statusInput.options.map(option => {
            if (option.value !== 'paused' && option.value !== 'active') return null;
            const status = option.value as 'paused' | 'active';
            return <Button key={status} disabled={busy} onClick={() => void preview({ type: 'status.set', objectType: level, objectId, status }, statusSupport, `${option.label} this ${t(level)}.`)}>{option.label}</Button>;
          })}</div> : null}
          {budgetSupport && budgetInput?.kind === 'money-minor' && budgetInput.budgetKinds.length ? <form className="ads-object-manager__row" onSubmit={event => submitBudget(event, budgetSupport, budgetInput.budgetKinds)} noValidate>
            <label><span className="sr-only">{t('text104')}</span><select value={budgetInput.budgetKinds.includes(budgetKind) ? budgetKind : budgetInput.budgetKinds[0]} onChange={event => setBudgetKind(event.target.value as 'daily' | 'lifetime')} disabled={busy}>{budgetInput.budgetKinds.map(kind => <option key={kind} value={kind}>{kind === 'daily' ? t('text105') : t('text106')}</option>)}</select></label>
            <label htmlFor={budgetFieldProps.id}><span className="sr-only">{t('text107')}{detail.currency ? t('currencyDetail', { currency: detail.currency }) : ''}</span><input {...budgetFieldProps} name="budget" aria-label={t('text250', { value0: detail.currency ? t('currencyDetail', { currency: detail.currency }) : '' })} inputMode="decimal" value={budget} onChange={event => { setBudget(event.target.value); validation.clear('budget'); }} placeholder={detail.currency ?? t('text108')} required disabled={busy} /></label>
            <FieldError {...validation.errorProps('budget')} />
            <Button type="submit" disabled={busy}>{budgetSupport.label}</Button>
            {limits ? <p className="small-note">{t('text109')}{formatBudgetMinor(limits.maxBudgetMinor, detail.currency)}{t('text251')}</p> : null}
          </form> : null}
          {renameSupport && nameInput?.kind === 'text' ? <form className="ads-object-manager__row" onSubmit={event => submitRename(event, renameSupport)} noValidate>
            <label htmlFor={nameFieldProps.id}><span className="sr-only">{t('text110')}</span><input {...nameFieldProps} name="name" aria-label={t('text110')} value={newName} onChange={event => { setNewName(event.target.value); validation.clear('name'); }} maxLength={limits?.nameMaxCharacters} required disabled={busy} /></label>
            <FieldError {...validation.errorProps('name')} />
            <Button type="submit" disabled={busy}>{renameSupport.label}</Button>
          </form> : null}
          {creativeSupport && creativeInput?.kind === 'creative-ref' && capabilities?.canListCreatives ? <div className="ads-object-manager__row">
            {creatives === null ? <Button disabled={busy} onClick={() => void loadCreatives()}>{t('text111')}</Button> : creatives.length === 0 ? <p className="small-note">{t('text112')}</p> : <>
              <label htmlFor={creativeFieldProps.id}><span className="sr-only">{t('text113')}</span><select {...creativeFieldProps} name="creativeId" aria-label={t('text113')} value={creativeId} onChange={event => { setCreativeId(event.target.value); validation.clear('creativeId'); }} disabled={busy}><option value="">{t('text111')}</option>{creatives.map(item => <option key={item.id} value={item.id}>{item.name || item.title || item.id}</option>)}</select></label>
              <FieldError {...validation.errorProps('creativeId')} />
              <Button disabled={busy || !creativeId} onClick={() => void preview({ type: 'creative.assign', objectType: 'ad', objectId, creativeId }, creativeSupport, t('text114'))}>{creativeSupport.label}</Button>
            </>}
          </div> : null}
          {deleteSupport ? <div className="ads-object-manager__row"><Button variant="danger" disabled={busy} onClick={() => void preview({ type: 'delete', objectType: level, objectId }, deleteSupport, t('text252', { value0: t(level) }))}>{deleteSupport.label}{t('text253')}</Button></div> : null}
        </>}
      </> : null}
      {outcome ? <><RouteNotice error={outcome.tone !== 'ok'} className={outcome.tone === 'ok' ? 'small-note' : 'ui-error'} focusKey={outcome.key}>{localize(outcome.text)}</RouteNotice>{outcome.tone === 'unknown' ? <a href="/ads/objects#changes">{t('text102')}</a> : null}</> : null}
    </div> : null}
    {pending && !pendingDialogOpen ? <div className="ads-object-manager__pending" role="region" aria-labelledby={`${id}-pending-title`}>
      <h3 id={`${id}-pending-title`}>{t('text115')}</h3>
      <RouteNotice error className="ui-error" focusKey={pending.feedback ?? 'unknown-ads-change'}>{pending.feedback ?? t('text116')}</RouteNotice>
      <p className="small-note">{t('text117')}</p>
      <Button onClick={() => void apply()} disabled={busy || pending.blockedByOpenChange !== false}>{busy ? t('text118') : t('text254')}</Button>{' '}
      <a href="/ads/objects#changes">{t('text102')}</a>
    </div> : null}
    {pending && pendingDialogOpen ? <ModalDialog className="ui-dialog" labelledBy={`${id}-title`} onDismiss={() => { if (!busy) { setPending(null); setPendingDialogOpen(false); } }} busy={busy}>
      <div className="ui-dialog__header"><div><h2 id={`${id}-title`}>{t('text119')}</h2><p>{pending.summary}</p></div></div>
      <div className="ui-dialog__body">
        {pending.spendChanging ? <p role="note"><strong>{t('text120')}</strong></p> : null}
        {pending.irreversible ? <p role="note"><strong>{t('text121')}</strong></p> : null}
        <p>{t(level)} {t('text166')}{name}</p>
        {pending.blockedByOpenChange === true ? <p role="alert">{t('text122')}<a href="/ads/objects#changes">{t('text102')}</a>{t('text251')}</p> : null}
        {pending.blockedByOpenChange === null ? <p role="alert">{t('text123')}<a href="/ads/objects#changes">{t('text102')}</a>{t('text251')}</p> : null}
        {pending.feedback ? <p role="alert" className="ui-error">{localize(pending.feedback)} <a href="/ads/objects#changes">{t('text102')}</a>{t('text251')}</p> : null}
        {pending.blockedByOpenChange === false && !pending.feedback ? <p className="small-note">{t('text124')}</p> : null}
      </div>
      <div className="ui-dialog__actions">
        <Button data-dialog-cancel onClick={() => { setPending(null); setPendingDialogOpen(false); }} disabled={busy}>{t('text125')}</Button>
        <Button variant="primary" onClick={() => void apply()} disabled={busy || pending.blockedByOpenChange !== false}>{busy ? t('text126') : t('text255')}</Button>
      </div>
    </ModalDialog> : null}
  </div>;
}
