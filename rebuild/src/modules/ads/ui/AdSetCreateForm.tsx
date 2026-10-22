'use client';
import { useAdsMessage } from '@/modules/ads/ui/AdsCopyProvider';
import { useAdsText } from '@/modules/ads/ui/AdsCopyProvider';

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { ModalDialog } from '@/components/ModalDialog';
import { FieldError, useFormValidation } from '@/components/FormValidation';
import { budgetFractionDigits, formatBudgetMinor, parseBudgetAmount } from './budget';
import { fillAdsTemplate as fill, type AdsUiSchema } from '@/platforms/ads-ui';
import { classifyCreationResponse, creationSuccessMessage, NETWORK_HELD_MESSAGE, REFUSED_HELD_NOTE, RESTORED_HELD_MESSAGE } from './CampaignCreateForm';
import { clearCreation, loadCreation, saveCreation, type CreationOwnerScope } from './creationRequestStore';

type Config = NonNullable<AdsUiSchema['adSet']>;
type Review = { name: string; dailyBudgetMinor: number; countryCode: string; optimizationGoal: string; confirmation: string; requestId: string };

export function AdSetCreateForm({ adAccountId, campaignId, campaignName, currency, config, ownerScope }: { adAccountId: string; campaignId: string; campaignName: string; currency: string | null; config: Config; ownerScope: CreationOwnerScope }) {
  const localize = useAdsMessage();
  const t = useAdsText();
  const { userId, workspaceId } = ownerScope;
  const owner = useMemo(() => ({ userId, workspaceId }), [userId, workspaceId]);
  const transmissions = useRef(0);
  const [refusalReason, setRefusalReason] = useState<string | undefined>();
  const [name, setName] = useState('');
  const [budget, setBudget] = useState('');
  const [countryCode, setCountryCode] = useState('');
  const [optimizationGoal, setOptimizationGoal] = useState(config.defaultOption);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [dialogError, setDialogError] = useState('');
  const [held, setHeld] = useState('');
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [pendingRequest, setPendingRequest] = useState<Review | null>(null);
  const validation = useFormValidation();
  const locked = busy || Boolean(held);
  const scope = `${adAccountId}:${campaignId}`;

  // After a reload, restore the original request and hold it; nothing is resent automatically.
  useEffect(() => {
    const stored = loadCreation<Review>('adset', owner, scope, value => typeof value.name === 'string' && typeof value.dailyBudgetMinor === 'number' && Number.isSafeInteger(value.dailyBudgetMinor) && typeof value.countryCode === 'string' && typeof value.optimizationGoal === 'string' && typeof value.confirmation === 'string' && typeof value.requestId === 'string');
    if (!stored || stored.request.requestId !== stored.requestId) return;
    const { request } = stored;
    transmissions.current = stored.transmissions;
    const digits = budgetFractionDigits(currency);
    setPendingRequest(request); setName(request.name); setBudget((request.dailyBudgetMinor / 10 ** digits).toFixed(digits)); setCountryCode(request.countryCode); setOptimizationGoal(request.optimizationGoal); setHeld(t('restoredHeld'));
  }, [owner, scope, currency]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (locked) return;
    const cleanName = name.trim();
    const minorBudget = parseBudgetAmount(budget, currency);
    const country = countryCode.trim().toUpperCase();
    const customErrors: Record<string, string> = {};
    if (!cleanName || cleanName.length > config.nameMaxLength) customErrors.name = t('text216', { value0: config.nameMaxLength });
    if (minorBudget === null) customErrors.budget = t('text217', { value0: currency ? t('currencyDetail', { currency }) : '', value1: budgetFractionDigits(currency) });
    if (!/^[A-Z]{2}$/.test(country)) customErrors.countryCode = t('text218');
    if (!validation.validate(event.currentTarget, customErrors)) { setMessage(t('text219')); return; }
    if (minorBudget === null) return;
    const confirmation = fill(config.confirmationTemplate, { nameJson: JSON.stringify(cleanName), campaignId, adAccountId, dailyBudgetMinor: String(minorBudget), currencySuffix: currency ? ` ${currency}` : '', countryCode: country, optimizationGoal });
    // The same reviewed payload keeps its request id; any change mints a new one.
    const prior = pendingRequest;
    const same = prior && prior.name === cleanName && prior.dailyBudgetMinor === minorBudget && prior.countryCode === country && prior.optimizationGoal === optimizationGoal && prior.confirmation === confirmation;
    setDialogError(''); setMessage(''); setRefusalReason(undefined);
    if (!same) transmissions.current = 0;
    setPendingRequest(same ? prior : { name: cleanName, dailyBudgetMinor: minorBudget, countryCode: country, optimizationGoal, confirmation, requestId: globalThis.crypto.randomUUID() });
    setConfirmationOpen(true);
  }

  async function confirmCreate() {
    if (!pendingRequest || busy) return;
    const request = pendingRequest;
    setBusy(true); setMessage(''); setDialogError('');
    // Count the send before it leaves: a lost reply must never read as "never sent".
    const sent = ++transmissions.current;
    if (!saveCreation('adset', owner, scope, request.requestId, request, sent)) {
      transmissions.current--;
      setBusy(false);
      setDialogError(t('text205'));
      return;
    }
    try {
      const response = await fetch('/api/ads/adsets', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ adAccountId, campaignId, ...request }) });
      const result = await classifyCreationResponse(response, t('text220'), t);
      if (result.kind === 'success') {
        setMessage(creationSuccessMessage('ad set', result, t('dailyBudgetDetail', { amount: formatBudgetMinor(request.dailyBudgetMinor, currency) }), t));
        clearCreation('adset', owner, scope); transmissions.current = 0; setName(''); setBudget(''); setConfirmationOpen(false); setPendingRequest(null); setHeld('');
      } else if (result.kind === 'attested' || result.kind === 'rejected') {
        clearCreation('adset', owner, scope); transmissions.current = 0; setMessage(result.message); setConfirmationOpen(false); setPendingRequest(null); setHeld('');
      } else if (result.kind === 'held') {
        setHeld(result.message); setConfirmationOpen(false);
      } else if (sent === 1) {
        // Only an identity sent exactly once, and refused before dispatch, has no unknown earlier send to protect.
        clearCreation('adset', owner, scope); transmissions.current = 0; setRefusalReason(result.reason); setDialogError(result.message);
      } else {
        setHeld(`${result.message} ${t('refusedHeld')}`); setConfirmationOpen(false);
      }
    } catch {
      setHeld(t('networkHeld')); setConfirmationOpen(false);
    } finally { setBusy(false); }
  }

  return <form method="post" noValidate className="ads-campaign-create" onSubmit={handleSubmit} aria-label={t('text221', { value0: campaignName })}>
    <h4>{fill(config.title, { campaignName })}</h4>
    <p className="small-note">{fill(config.description, { currency: currency ? t('currencyDetail', { currency }) : '' })}</p>
    <div className="ads-campaign-create__fields">
      <label>{config.nameLabel}<input name="name" value={name} onChange={event => setName(event.target.value)} maxLength={config.nameMaxLength} required disabled={locked} {...validation.fieldProps('name')} /><FieldError {...validation.errorProps('name')} /></label>
      <label>{config.budgetLabel}{currency ? ` (${currency})` : ''}<input name="budget" type="number" min={10 ** -budgetFractionDigits(currency)} step={10 ** -budgetFractionDigits(currency)} value={budget} onChange={event => setBudget(event.target.value)} inputMode="decimal" required disabled={locked} {...validation.fieldProps('budget')} /><FieldError {...validation.errorProps('budget')} /></label>
      <label>{config.countryLabel}<input name="countryCode" value={countryCode} onChange={event => setCountryCode(event.target.value.toUpperCase())} maxLength={2} pattern="[A-Za-z]{2}" placeholder={t('text222')} required disabled={locked} {...validation.fieldProps('countryCode')} /><FieldError {...validation.errorProps('countryCode')} /></label>
      <label>{config.goalLabel}<select value={optimizationGoal} onChange={event => setOptimizationGoal(event.target.value)} disabled={locked}>{config.options.map(({value, label}) => <option key={value} value={value}>{label}</option>)}</select></label>
      <button className="ui-button ui-button--primary" type="submit" disabled={locked}>{busy ? t('text208') : config.actionLabel}</button>
    </div>
    {message ? <p role="status" className="small-note">{localize(message)}</p> : null}
    {held && pendingRequest ? <div role="region" aria-label={t('text223')} className="ads-object-manager__pending">
      <p role="alert" className="ui-error">{localize(held)}</p>
      <p className="small-note">{t('text210')}<a href="/insights/ads/manage#changes">{t('text211')}</a> {t('text212')}</p>
      <button className="ui-button ui-button--primary" type="button" onClick={() => void confirmCreate()} disabled={busy}>{busy ? t('text118') : t('text213')}</button>
    </div> : null}
    {confirmationOpen && pendingRequest ? <ModalDialog className="ui-dialog" labelledBy={`adset-confirm-title-${adAccountId}-${campaignId}`} onDismiss={() => { if (!busy) setConfirmationOpen(false); }} busy={busy}>
      <div className="ui-dialog__header"><div><h2 id={`adset-confirm-title-${adAccountId}-${campaignId}`}>{config.confirmTitle}</h2><p>{config.confirmDescription}</p></div></div>
      <div className="ui-dialog__body"><p><strong>{pendingRequest.name}</strong> {t('text224')}{campaignName}</p><p>{config.budgetLabel}{t('text225')}{formatBudgetMinor(pendingRequest.dailyBudgetMinor, currency)} {t('text166')}{pendingRequest.countryCode} {t('text166')}{config.options.find(option => option.value === pendingRequest.optimizationGoal)?.label ?? pendingRequest.optimizationGoal}</p>{dialogError ? <p role="alert" className="ui-error">{localize(dialogError)}{refusalReason === 'blocked_by_other_request' ? <> <a href="/insights/ads/manage#changes">{t('text214')}</a> {t('text215')}</> : null}</p> : null}</div>
      <div className="ui-dialog__actions"><button className="ui-button ui-button--secondary" type="button" data-dialog-cancel onClick={() => setConfirmationOpen(false)} disabled={busy}>{t('text125')}</button><button className="ui-button ui-button--primary" type="button" onClick={() => void confirmCreate()} disabled={busy}>{busy ? t('text208') : config.actionLabel}</button></div>
    </ModalDialog> : null}
  </form>;
}
