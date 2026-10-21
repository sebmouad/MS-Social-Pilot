import { useAdsMessage } from '@/modules/ads/ui/AdsCopyProvider';
'use client';
import { adsTranslator, type AdsTranslator } from '../copy';
import { useAdsText } from '@/modules/ads/ui/AdsCopyProvider';

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { ModalDialog } from '@/components/ModalDialog';
import { FieldError, useFormValidation } from '@/components/FormValidation';
import { fillAdsTemplate as fill, type AdsUiSchema } from '@/platforms/ads-ui';
import { clearCreation, loadCreation, saveCreation, type CreationOwnerScope } from './creationRequestStore';

type Config = NonNullable<AdsUiSchema['campaign']>;

export type CreationResult =
  | { kind: 'success'; remoteId: string | null; warning?: string; replay: boolean }
  | { kind: 'attested'; message: string }
  | { kind: 'rejected'; message: string }
  | { kind: 'held'; message: string }
  | { kind: 'refused'; message: string; reason?: string };

const HELD_MESSAGE = adsTranslator()('heldCreation');
export const REFUSED_HELD_NOTE = adsTranslator()('refusedHeld');

/**
 * Classify a creation response. Only a confirmed success is ever shown as success.
 * `attempt: "not_dispatched"` describes that one transmission only. Whether it may release the request
 * identity is decided by the caller from how many times the id has been sent; everything else stays held.
 */
export async function classifyCreationResponse(response: Response, fallbackError: string, t: AdsTranslator = adsTranslator()): Promise<CreationResult> {
  const payload = await response.json().catch(() => null) as { outcome?: string; remoteId?: string | null; created?: { remoteId?: string }; campaignId?: string; adSetId?: string; warning?: string; message?: string; error?: string; replay?: boolean; status?: string; attempt?: string; reason?: string } | null;
  if (response.ok && payload?.outcome === 'succeeded' && payload.status === 'resolved_applied') return { kind: 'attested', message: t('attestedCreation') };
  if (response.ok && payload?.outcome === 'succeeded') {
    const remoteId = payload.created?.remoteId ?? payload.campaignId ?? payload.adSetId ?? payload.remoteId ?? null;
    if (!remoteId) return { kind: 'held', message: t('identityUnknown') };
    return { kind: 'success', remoteId, warning: payload.warning, replay: payload.replay === true };
  }
  if (response.ok && payload?.outcome === 'rejected') return { kind: 'rejected', message: payload.message ?? t('text200') };
  if (response.ok && payload?.outcome === 'uncertain') return { kind: 'held', message: payload.message ?? t('heldCreation') };
  if (!response.ok && payload?.attempt === 'not_dispatched') return { kind: 'refused', message: payload.error || fallbackError, reason: payload.reason };
  return { kind: 'held', message: payload?.message ?? payload?.error ?? t('heldCreation') };
}

/** Success wording. A replay reports the earlier creation without claiming the object is still paused. */
export function creationSuccessMessage(noun: 'campaign' | 'ad set', result: { remoteId: string | null; replay: boolean; warning?: string }, detail = '', t: AdsTranslator = adsTranslator()) {
  const idText = result.remoteId ? ` (${result.remoteId})` : '';
  const text = result.replay
    ? t('text201', { value0: t(noun === 'campaign' ? 'campaign' : 'adset'), value1: idText, value2: detail })
    : t('text202', { value0: t(noun === 'campaign' ? 'campaign' : 'adset'), value1: idText, value2: detail });
  return `${text}${result.warning ? ` ${result.warning}` : ''}`;
}

export const RESTORED_HELD_MESSAGE = adsTranslator()('restoredHeld');
export const NETWORK_HELD_MESSAGE = adsTranslator()('networkHeld');

type Review = { name: string; objective: string; confirmation: string; requestId: string };

export function CampaignCreateForm({ adAccountId, accountName, config, ownerScope }: { adAccountId: string; accountName: string; config: Config; ownerScope: CreationOwnerScope }) {
  const localize = useAdsMessage();
  const t = useAdsText();
  const { userId, workspaceId } = ownerScope;
  const owner = useMemo(() => ({ userId, workspaceId }), [userId, workspaceId]);
  const transmissions = useRef(0);
  const [refusalReason, setRefusalReason] = useState<string | undefined>();
  const [name, setName] = useState('');
  const [objective, setObjective] = useState(config.defaultOption);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [review, setReview] = useState<Review | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [held, setHeld] = useState('');
  const [dialogError, setDialogError] = useState('');
  const validation = useFormValidation();
  const locked = busy || Boolean(held);

  // After a reload, restore the original request and hold it; nothing is resent automatically.
  useEffect(() => {
    const stored = loadCreation<Review>('campaign', owner, adAccountId, value => typeof value.name === 'string' && typeof value.objective === 'string' && typeof value.confirmation === 'string' && typeof value.requestId === 'string');
    if (!stored || stored.request.requestId !== stored.requestId) return;
    transmissions.current = stored.transmissions;
    setReview(stored.request); setName(stored.request.name); setObjective(stored.request.objective); setHeld(t('restoredHeld'));
  }, [owner, adAccountId]);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (locked) return;
    const cleanName = name.trim();
    const customErrors = !cleanName || cleanName.length > config.nameMaxLength
      ? { name: t('text203', { value0: config.nameMaxLength }) }
      : undefined;
    if (!validation.validate(event.currentTarget, customErrors)) { setMessage(t('text204')); return; }
    const confirmation = fill(config.confirmationTemplate, { nameJson: JSON.stringify(cleanName), adAccountId, objective });
    // The same reviewed payload keeps its request id; any change mints a new one.
    const samePayload = review && review.name === cleanName && review.objective === objective && review.confirmation === confirmation;
    if (!samePayload) transmissions.current = 0;
    setReview(samePayload ? review : { name: cleanName, objective, confirmation, requestId: globalThis.crypto.randomUUID() });
    setMessage(''); setDialogError(''); setRefusalReason(undefined);
    setConfirming(true);
  }

  async function confirmCreate() {
    if (!review || busy) return;
    const request = review;
    setBusy(true); setMessage(''); setDialogError('');
    // Count the send before it leaves: a lost reply must never read as "never sent".
    const sent = ++transmissions.current;
    if (!saveCreation('campaign', owner, adAccountId, request.requestId, request, sent)) {
      transmissions.current--;
      setBusy(false);
      setDialogError(t('text205'));
      return;
    }
    try {
      const response = await fetch('/api/ads/campaigns', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ adAccountId, name: request.name, objective: request.objective, confirmation: request.confirmation, requestId: request.requestId }) });
      const result = await classifyCreationResponse(response, t('text206'), t);
      if (result.kind === 'success') {
        setMessage(creationSuccessMessage('campaign', result, '', t));
        clearCreation('campaign', owner, adAccountId); transmissions.current = 0; setName(''); setConfirming(false); setReview(null); setHeld('');
      } else if (result.kind === 'attested' || result.kind === 'rejected') {
        clearCreation('campaign', owner, adAccountId); transmissions.current = 0; setMessage(result.message); setConfirming(false); setReview(null); setHeld('');
      } else if (result.kind === 'held') {
        setHeld(result.message); setConfirming(false);
      } else if (sent === 1) {
        // Only an identity sent exactly once, and refused before dispatch, has no unknown earlier send to protect.
        clearCreation('campaign', owner, adAccountId); transmissions.current = 0; setRefusalReason(result.reason); setDialogError(result.message);
      } else {
        setHeld(`${result.message} ${t('refusedHeld')}`); setConfirming(false);
      }
    } catch {
      setHeld(t('networkHeld')); setConfirming(false);
    } finally { setBusy(false); }
  }

  return <form method="post" noValidate className="ads-campaign-create" onSubmit={create} aria-label={t('text207', { value0: accountName })}>
    <h3>{config.title}</h3>
    <p className="small-note">{config.description}</p>
    <div className="ads-campaign-create__fields">
      <label>{config.nameLabel}<input name="name" value={name} onChange={event => setName(event.target.value)} maxLength={config.nameMaxLength} required disabled={locked} {...validation.fieldProps('name')} /><FieldError {...validation.errorProps('name')} /></label>
      <label>{config.optionLabel}<select value={objective} onChange={event => setObjective(event.target.value)} disabled={locked}>{config.options.map(({value, label}) => <option key={value} value={value}>{label}</option>)}</select></label>
      <button className="ui-button ui-button--primary" type="submit" disabled={locked}>{busy ? t('text208') : config.actionLabel}</button>
    </div>
    {message ? <p role="status" className="small-note">{localize(message)}</p> : null}
    {held && review ? <div role="region" aria-label={t('text209')} className="ads-object-manager__pending">
      <p role="alert" className="ui-error">{localize(held)}</p>
      <p className="small-note">{t('text210')}<a href="/ads/objects#changes">{t('text211')}</a> {t('text212')}</p>
      <button className="ui-button ui-button--primary" type="button" onClick={() => void confirmCreate()} disabled={busy}>{busy ? t('text118') : t('text213')}</button>
    </div> : null}
    {confirming && review ? <ModalDialog className="ui-dialog" labelledBy={`campaign-confirm-${adAccountId}`} onDismiss={() => { if (!busy) setConfirming(false); }} busy={busy}>
      <div className="ui-dialog__header"><div><h2 id={`campaign-confirm-${adAccountId}`}>{config.confirmTitle}</h2><p>{config.confirmDescription}</p></div></div>
      <div className="ui-dialog__body"><p><strong>{review.name}</strong> {t('text166')}{config.options.find(option => option.value === review.objective)?.label ?? review.objective} {t('text166')}{accountName}</p>{dialogError && <p role="alert" className="ui-error">{localize(dialogError)}{refusalReason === 'blocked_by_other_request' ? <> <a href="/ads/objects#changes">{t('text214')}</a> {t('text215')}</> : null}</p>}</div>
      <div className="ui-dialog__actions"><button className="ui-button ui-button--secondary" type="button" data-dialog-cancel onClick={() => setConfirming(false)} disabled={busy}>{t('text125')}</button><button className="ui-button ui-button--primary" type="button" onClick={() => void confirmCreate()} disabled={busy}>{busy ? t('text208') : config.actionLabel}</button></div>
    </ModalDialog> : null}
  </form>;
}
