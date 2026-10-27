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
type Targeting = { extraCountryCodes?: string[]; ageMin?: number; ageMax?: number; endDate?: string };
type Review = { name: string; dailyBudgetMinor: number; countryCode: string; optimizationGoal: string; confirmation: string; requestId: string } & Targeting;

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
  const [moreCountries, setMoreCountries] = useState('');
  const [ageMin, setAgeMin] = useState('');
  const [ageMax, setAgeMax] = useState('');
  const [endDate, setEndDate] = useState('');
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
    setPendingRequest(request); setName(request.name); setBudget((request.dailyBudgetMinor / 10 ** digits).toFixed(digits)); setCountryCode(request.countryCode); setOptimizationGoal(request.optimizationGoal); setMoreCountries((request.extraCountryCodes ?? []).join(', ')); setAgeMin(request.ageMin?.toString() ?? ''); setAgeMax(request.ageMax?.toString() ?? ''); setEndDate(request.endDate ?? ''); setHeld(t('restoredHeld'));
  }, [owner, scope, currency]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (locked) return;
    const form = event.currentTarget;
    const cleanName = name.trim();
    const minorBudget = parseBudgetAmount(budget, currency);
    const country = countryCode.trim().toUpperCase();
    const customErrors: Record<string, string> = {};
    if (!cleanName || cleanName.length > config.nameMaxLength) customErrors.name = t('text216', { value0: config.nameMaxLength });
    if (minorBudget === null) customErrors.budget = t('text217', { value0: currency ? t('currencyDetail', { currency }) : '', value1: budgetFractionDigits(currency) });
    if (!/^[A-Z]{2}$/.test(country)) customErrors.countryCode = t('text218');
    const extras = [...new Set(moreCountries.toUpperCase().split(/[\s,;]+/).filter(Boolean))].filter(code => code !== country);
    const targeting: Targeting = { ...(extras.length ? { extraCountryCodes: extras } : {}), ...(ageMin ? { ageMin: Number(ageMin) } : {}), ...(ageMax ? { ageMax: Number(ageMax) } : {}), ...(endDate ? { endDate } : {}) };
    const ages = [targeting.ageMin, targeting.ageMax].filter((age): age is number => age !== undefined);
    if (extras.some(code => !/^[A-Z]{2}$/.test(code)) || extras.length > 24 || ages.some(age => !Number.isInteger(age) || age < 18 || age > 65) || (targeting.ageMin !== undefined && targeting.ageMax !== undefined && targeting.ageMin > targeting.ageMax) || (endDate && endDate <= new Date().toISOString().slice(0, 10))) customErrors.targeting = t('adSetTargetingInvalid');
    if (!validation.validate(form, customErrors)) { setMessage(customErrors.targeting ?? t('text219')); return; }
    if (minorBudget === null) return;
    const plain = !targeting.extraCountryCodes && targeting.ageMin === undefined && targeting.ageMax === undefined && !targeting.endDate;
    // Plain requests keep the template confirmation; optional targeting adds a server-owned suffix, so the exact text comes from the preview.
    let confirmation = fill(config.confirmationTemplate, { nameJson: JSON.stringify(cleanName), campaignId, adAccountId, dailyBudgetMinor: String(minorBudget), currencySuffix: currency ? ` ${currency}` : '', countryCode: country, optimizationGoal });
    if (!plain) {
      try {
        const response = await fetch('/api/ads/management', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'preview', adAccountId, operation: { type: 'adset.create', objectType: 'adset', parentId: campaignId, name: cleanName, dailyBudgetMinor: minorBudget, countryCode: country, optimizationGoal, ...targeting } }) });
        const preview = await response.json();
        if (!response.ok || typeof preview.confirmation !== 'string') { setMessage(typeof preview.error === 'string' ? preview.error : t('adSetTargetingInvalid')); return; }
        confirmation = preview.confirmation;
      } catch { setMessage(t('text220')); return; }
    }
    // The same reviewed payload keeps its request id; any change mints a new one.
    const prior = pendingRequest;
    const same = prior && prior.name === cleanName && prior.dailyBudgetMinor === minorBudget && prior.countryCode === country && prior.optimizationGoal === optimizationGoal && prior.confirmation === confirmation && JSON.stringify([prior.extraCountryCodes, prior.ageMin, prior.ageMax, prior.endDate]) === JSON.stringify([targeting.extraCountryCodes, targeting.ageMin, targeting.ageMax, targeting.endDate]);
    setDialogError(''); setMessage(''); setRefusalReason(undefined);
    if (!same) transmissions.current = 0;
    setPendingRequest(same ? prior : { name: cleanName, dailyBudgetMinor: minorBudget, countryCode: country, optimizationGoal, ...targeting, confirmation, requestId: globalThis.crypto.randomUUID() });
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

  return <form method="post" noValidate className="ads-campaign-create" onSubmit={event => void handleSubmit(event)} aria-label={t('text221', { value0: campaignName })}>
    <h4>{fill(config.title, { campaignName })}</h4>
    <p className="small-note">{fill(config.description, { currency: currency ? t('currencyDetail', { currency }) : '' })}</p>
    <div className="ads-campaign-create__fields">
      <label>{config.nameLabel}<input name="name" value={name} onChange={event => setName(event.target.value)} maxLength={config.nameMaxLength} required disabled={locked} {...validation.fieldProps('name')} /><FieldError {...validation.errorProps('name')} /></label>
      <label>{config.budgetLabel}{currency ? ` (${currency})` : ''}<input name="budget" type="number" min={10 ** -budgetFractionDigits(currency)} step={10 ** -budgetFractionDigits(currency)} value={budget} onChange={event => setBudget(event.target.value)} inputMode="decimal" required disabled={locked} {...validation.fieldProps('budget')} /><FieldError {...validation.errorProps('budget')} /></label>
      <label>{config.countryLabel}<input name="countryCode" value={countryCode} onChange={event => setCountryCode(event.target.value.toUpperCase())} maxLength={2} pattern="[A-Za-z]{2}" placeholder={t('text222')} required disabled={locked} {...validation.fieldProps('countryCode')} /><FieldError {...validation.errorProps('countryCode')} /></label>
      <label>{t('adSetMoreCountries')}<input name="moreCountries" value={moreCountries} onChange={event => setMoreCountries(event.target.value.toUpperCase())} maxLength={80} disabled={locked} /></label>
      <label>{t('adSetAgeMin')}<input name="ageMin" type="number" min={18} max={65} value={ageMin} onChange={event => setAgeMin(event.target.value)} placeholder="18" disabled={locked} /></label>
      <label>{t('adSetAgeMax')}<input name="ageMax" type="number" min={18} max={65} value={ageMax} onChange={event => setAgeMax(event.target.value)} placeholder="65" disabled={locked} /></label>
      <label>{t('adSetEndDate')}<input name="endDate" type="date" value={endDate} min={new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)} onChange={event => setEndDate(event.target.value)} disabled={locked} aria-describedby={`adset-end-hint-${campaignId}`} /><span id={`adset-end-hint-${campaignId}`} className="small-note">{t('adSetEndHint')}</span></label>
      <label>{config.goalLabel}<select value={optimizationGoal} onChange={event => setOptimizationGoal(event.target.value)} disabled={locked}>{config.options.map(({value, label}) => <option key={value} value={value}>{label}</option>)}</select></label>
      <button className="ui-button ui-button--primary" type="submit" disabled={locked}>{busy ? t('text208') : config.actionLabel}</button>
    </div>
    {message ? <p role="status" className="small-note">{localize(message)}</p> : null}
    {held && pendingRequest ? <div role="region" aria-label={t('text223')} className="ads-object-manager__pending">
      <p role="alert" className="ui-error">{localize(held)}</p>
      <p className="small-note">{t('text210')}<a href="/ads/manage#changes">{t('text211')}</a> {t('text212')}</p>
      <button className="ui-button ui-button--primary" type="button" onClick={() => void confirmCreate()} disabled={busy}>{busy ? t('text118') : t('text213')}</button>
    </div> : null}
    {confirmationOpen && pendingRequest ? <ModalDialog className="ui-dialog" labelledBy={`adset-confirm-title-${adAccountId}-${campaignId}`} onDismiss={() => { if (!busy) setConfirmationOpen(false); }} busy={busy}>
      <div className="ui-dialog__header"><div><h2 id={`adset-confirm-title-${adAccountId}-${campaignId}`}>{config.confirmTitle}</h2><p>{config.confirmDescription}</p></div></div>
      <div className="ui-dialog__body"><p><strong>{pendingRequest.name}</strong> {t('text224')}{campaignName}</p><p>{config.budgetLabel}{t('text225')}{formatBudgetMinor(pendingRequest.dailyBudgetMinor, currency)} {t('text166')}{pendingRequest.countryCode} {t('text166')}{config.options.find(option => option.value === pendingRequest.optimizationGoal)?.label ?? pendingRequest.optimizationGoal}</p>{pendingRequest.extraCountryCodes?.length || pendingRequest.ageMin !== undefined || pendingRequest.ageMax !== undefined || pendingRequest.endDate ? <p>{[pendingRequest.extraCountryCodes?.length ? `${t('adSetMoreCountries').split(' (')[0]}: ${pendingRequest.extraCountryCodes.join(', ')}` : '', pendingRequest.ageMin !== undefined || pendingRequest.ageMax !== undefined ? `${pendingRequest.ageMin ?? 18}–${pendingRequest.ageMax ?? 65}` : '', pendingRequest.endDate ? `${t('adSetEndDate').split(' (')[0]}: ${pendingRequest.endDate}` : ''].filter(Boolean).join(' · ')}</p> : null}{dialogError ? <p role="alert" className="ui-error">{localize(dialogError)}{refusalReason === 'blocked_by_other_request' ? <> <a href="/ads/manage#changes">{t('text214')}</a> {t('text215')}</> : null}</p> : null}</div>
      <div className="ui-dialog__actions"><button className="ui-button ui-button--secondary" type="button" data-dialog-cancel onClick={() => setConfirmationOpen(false)} disabled={busy}>{t('text125')}</button><button className="ui-button ui-button--primary" type="button" onClick={() => void confirmCreate()} disabled={busy}>{busy ? t('text208') : config.actionLabel}</button></div>
    </ModalDialog> : null}
  </form>;
}
