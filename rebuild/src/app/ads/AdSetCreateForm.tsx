'use client';

import { useState, type FormEvent } from 'react';
import { ModalDialog } from '@/components/ModalDialog';
import { budgetFractionDigits, formatBudgetMinor, parseBudgetAmount } from './budget';

const goals = [
  ['LINK_CLICKS', 'Link clicks'], ['IMPRESSIONS', 'Impressions'],
] as const;

export function AdSetCreateForm({ adAccountId, campaignId, campaignName, currency }: { adAccountId: string; campaignId: string; campaignName: string; currency: string | null }) {
  const [name, setName] = useState('');
  const [budget, setBudget] = useState('');
  const [countryCode, setCountryCode] = useState('');
  const [optimizationGoal, setOptimizationGoal] = useState<(typeof goals)[number][0]>('LINK_CLICKS');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [dialogError, setDialogError] = useState('');
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [pendingRequest, setPendingRequest] = useState<{ name: string; dailyBudgetMinor: number; countryCode: string; optimizationGoal: (typeof goals)[number][0]; confirmation: string } | null>(null);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanName = name.trim();
    const minorBudget = parseBudgetAmount(budget, currency);
    const country = countryCode.trim().toUpperCase();
    if (!cleanName || cleanName.length > 100) { setMessage('Enter an ad set name from 1 to 100 characters.'); return; }
    if (minorBudget === null) { setMessage(`Enter a valid daily budget${currency ? ` in ${currency}` : ''} with up to ${budgetFractionDigits(currency)} decimal places.`); return; }
    if (!/^[A-Z]{2}$/.test(country)) { setMessage('Enter a two-letter country code, such as MA.'); return; }
    const confirmation = `CREATE PAUSED FACEBOOK AD SET ${JSON.stringify(cleanName)} UNDER CAMPAIGN ${campaignId} IN ACCOUNT ${adAccountId} WITH DAILY BUDGET ${minorBudget} MINOR UNITS TARGETING ${country} OPTIMIZED FOR ${optimizationGoal}`;
    setDialogError('');
    setPendingRequest({ name: cleanName, dailyBudgetMinor: minorBudget, countryCode: country, optimizationGoal, confirmation });
    setConfirmationOpen(true);
  }

  async function confirmCreate() {
    if (!pendingRequest) return;
    const request = pendingRequest;
    setBusy(true); setMessage(''); setDialogError('');
    try {
      const response = await fetch('/api/ads/adsets', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ adAccountId, campaignId, ...request }) });
      const payload = await response.json().catch(() => ({})) as { error?: string; adSetId?: string; auditRecorded?: boolean };
      if (!response.ok) throw new Error(payload.error || 'The ad set could not be created.');
      setMessage(payload.auditRecorded === false
        ? `Paused ad set created (${payload.adSetId}), but the audit record could not be saved. Do not submit this creation again.`
        : `Paused ad set created (${payload.adSetId}).`);
      setName(''); setBudget(''); setConfirmationOpen(false); setPendingRequest(null);
    } catch (error) { setDialogError(error instanceof Error ? error.message : 'The ad set could not be created.'); }
    finally { setBusy(false); }
  }

  return <form method="post" className="ads-campaign-create" onSubmit={handleSubmit} aria-label={`Create ad set under ${campaignName}`}>
    <h4>Create paused ad set under {campaignName}</h4>
    <p className="small-note">Uses impressions billing. Enter a daily amount{currency ? ` in ${currency}` : ''}; delivery targets one country.</p>
    <div className="ads-campaign-create__fields">
      <label>Ad set name<input value={name} onChange={event => setName(event.target.value)} maxLength={100} required disabled={busy} /></label>
      <label>Daily budget{currency ? ` (${currency})` : ''}<input type="number" min={10 ** -budgetFractionDigits(currency)} step={10 ** -budgetFractionDigits(currency)} value={budget} onChange={event => setBudget(event.target.value)} inputMode="decimal" required disabled={busy} /></label>
      <label>Country code<input value={countryCode} onChange={event => setCountryCode(event.target.value.toUpperCase())} maxLength={2} placeholder="MA" required disabled={busy} /></label>
      <label>Optimize for<select value={optimizationGoal} onChange={event => setOptimizationGoal(event.target.value as typeof optimizationGoal)} disabled={busy}>{goals.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <button type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create paused ad set'}</button>
    </div>
    {message ? <p role="status" className="small-note">{message}</p> : null}
    {confirmationOpen && pendingRequest ? <ModalDialog className="ui-dialog" labelledBy={`adset-confirm-title-${adAccountId}-${campaignId}`} onDismiss={() => { if (!busy) setConfirmationOpen(false); }} busy={busy}>
      <div className="ui-dialog__header"><div><h2 id={`adset-confirm-title-${adAccountId}-${campaignId}`}>Create this paused ad set?</h2><p>It will not deliver until activated separately.</p></div></div>
      <div className="ui-dialog__body"><p><strong>{pendingRequest.name}</strong> under {campaignName}</p><p>Daily budget: {formatBudgetMinor(pendingRequest.dailyBudgetMinor, currency)} · {pendingRequest.countryCode} · {goals.find(([value]) => value === pendingRequest.optimizationGoal)?.[1] ?? pendingRequest.optimizationGoal}</p>{dialogError ? <p role="alert" className="ui-error">{dialogError}</p> : null}</div>
      <div className="ui-dialog__actions"><button type="button" data-dialog-cancel onClick={() => setConfirmationOpen(false)} disabled={busy}>Cancel</button><button type="button" onClick={() => void confirmCreate()} disabled={busy}>{busy ? 'Creating…' : 'Create paused ad set'}</button></div>
    </ModalDialog> : null}
  </form>;
}
