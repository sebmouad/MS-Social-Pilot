'use client';

import { useState, type FormEvent } from 'react';
import { ModalDialog } from '@/components/ModalDialog';
import { budgetFractionDigits, formatBudgetMinor, parseBudgetAmount } from './budget';
import { fillAdsTemplate as fill, type AdsUiSchema } from '@/platforms/ads-ui';

type Config = NonNullable<AdsUiSchema['adSet']>;

export function AdSetCreateForm({ adAccountId, campaignId, campaignName, currency, config }: { adAccountId: string; campaignId: string; campaignName: string; currency: string | null; config: Config }) {
  const [name, setName] = useState('');
  const [budget, setBudget] = useState('');
  const [countryCode, setCountryCode] = useState('');
  const [optimizationGoal, setOptimizationGoal] = useState(config.defaultOption);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [dialogError, setDialogError] = useState('');
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [pendingRequest, setPendingRequest] = useState<{ name: string; dailyBudgetMinor: number; countryCode: string; optimizationGoal: string; confirmation: string } | null>(null);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanName = name.trim();
    const minorBudget = parseBudgetAmount(budget, currency);
    const country = countryCode.trim().toUpperCase();
    if (!cleanName || cleanName.length > config.nameMaxLength) { setMessage(`Enter an ad set name from 1 to ${config.nameMaxLength} characters.`); return; }
    if (minorBudget === null) { setMessage(`Enter a valid daily budget${currency ? ` in ${currency}` : ''} with up to ${budgetFractionDigits(currency)} decimal places.`); return; }
    if (!/^[A-Z]{2}$/.test(country)) { setMessage('Enter a two-letter country code, such as MA.'); return; }
    const confirmation = fill(config.confirmationTemplate, { nameJson: JSON.stringify(cleanName), campaignId, adAccountId, dailyBudgetMinor: String(minorBudget), countryCode: country, optimizationGoal });
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
    <h4>{fill(config.title, { campaignName })}</h4>
    <p className="small-note">{fill(config.description, { currency: currency ? ` in ${currency}` : '' })}</p>
    <div className="ads-campaign-create__fields">
      <label>{config.nameLabel}<input value={name} onChange={event => setName(event.target.value)} maxLength={config.nameMaxLength} required disabled={busy} /></label>
      <label>{config.budgetLabel}{currency ? ` (${currency})` : ''}<input type="number" min={10 ** -budgetFractionDigits(currency)} step={10 ** -budgetFractionDigits(currency)} value={budget} onChange={event => setBudget(event.target.value)} inputMode="decimal" required disabled={busy} /></label>
      <label>{config.countryLabel}<input value={countryCode} onChange={event => setCountryCode(event.target.value.toUpperCase())} maxLength={2} placeholder="MA" required disabled={busy} /></label>
      <label>{config.goalLabel}<select value={optimizationGoal} onChange={event => setOptimizationGoal(event.target.value)} disabled={busy}>{config.options.map(({value, label}) => <option key={value} value={value}>{label}</option>)}</select></label>
      <button type="submit" disabled={busy}>{busy ? 'Creating…' : config.actionLabel}</button>
    </div>
    {message ? <p role="status" className="small-note">{message}</p> : null}
    {confirmationOpen && pendingRequest ? <ModalDialog className="ui-dialog" labelledBy={`adset-confirm-title-${adAccountId}-${campaignId}`} onDismiss={() => { if (!busy) setConfirmationOpen(false); }} busy={busy}>
      <div className="ui-dialog__header"><div><h2 id={`adset-confirm-title-${adAccountId}-${campaignId}`}>{config.confirmTitle}</h2><p>{config.confirmDescription}</p></div></div>
      <div className="ui-dialog__body"><p><strong>{pendingRequest.name}</strong> under {campaignName}</p><p>{config.budgetLabel}: {formatBudgetMinor(pendingRequest.dailyBudgetMinor, currency)} · {pendingRequest.countryCode} · {config.options.find(option => option.value === pendingRequest.optimizationGoal)?.label ?? pendingRequest.optimizationGoal}</p>{dialogError ? <p role="alert" className="ui-error">{dialogError}</p> : null}</div>
      <div className="ui-dialog__actions"><button type="button" data-dialog-cancel onClick={() => setConfirmationOpen(false)} disabled={busy}>Cancel</button><button type="button" onClick={() => void confirmCreate()} disabled={busy}>{busy ? 'Creating…' : config.actionLabel}</button></div>
    </ModalDialog> : null}
  </form>;
}
