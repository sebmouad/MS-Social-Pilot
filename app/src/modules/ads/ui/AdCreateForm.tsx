'use client';
import { useAdsMessage, useAdsText } from '@/modules/ads/ui/AdsCopyProvider';

import { useId, useState, type FormEvent } from 'react';
import { Button } from '@/components/Button';
import { FieldError, useFormValidation } from '@/components/FormValidation';
import { ModalDialog } from '@/components/ModalDialog';
import { RouteNotice } from '@/components/RouteNotice';
import type { AdsNeutralOperation } from '@/modules/ads/management/types';

type Creative = { id: string; name: string | null; title: string | null };
type Review = { operation: Extract<AdsNeutralOperation, { type: 'ad.create' }>; confirmation: string; requestId: string; spendChanging: boolean; blocked: boolean };

/**
 * Create a paused ad under one ad set from an existing creative. It speaks only the neutral preview/apply
 * service, so the confirmation text, spend warning, ledger and recovery are the shared management ones.
 * The same reviewed payload keeps its request id; an unknown outcome is held, never resent automatically.
 */
export function AdCreateForm({ adAccountId, adSetId, adSetName, nameMaxCharacters }: { adAccountId: string; adSetId: string; adSetName: string; nameMaxCharacters: number }) {
  const localize = useAdsMessage();
  const t = useAdsText();
  const id = useId();
  const validation = useFormValidation();
  const [name, setName] = useState('');
  const [creativeId, setCreativeId] = useState('');
  const [creatives, setCreatives] = useState<Creative[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState<Review | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [held, setHeld] = useState('');
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  async function loadCreatives() {
    setBusy(true); setMessage(null);
    try {
      const response = await fetch(`/api/ads/management?${new URLSearchParams({ view: 'creatives', adAccountId })}`);
      const payload = await response.json().catch(() => ({})) as { error?: string; items?: Creative[] };
      if (!response.ok || !payload.items) throw new Error(payload.error || t('text248'));
      setCreatives(payload.items);
    } catch (error) { setMessage({ tone: 'error', text: error instanceof Error ? error.message : t('text248') }); }
    finally { setBusy(false); }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || held) return;
    const cleanName = name.trim();
    const errors: Record<string, string> = {};
    if (!cleanName) errors.name = t('adCreateName');
    else if (cleanName.length > nameMaxCharacters) errors.name = t('text246', { value0: nameMaxCharacters });
    if (!creativeId) errors.creativeId = t('adCreateChooseCreative');
    if (!validation.validate(event.currentTarget, errors)) return;
    const operation = { type: 'ad.create', objectType: 'ad', parentId: adSetId, name: cleanName, creativeId } as const;
    setBusy(true); setMessage(null);
    try {
      const response = await fetch('/api/ads/management', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'preview', adAccountId, operation }) });
      const payload = await response.json().catch(() => ({})) as { error?: string; confirmation?: string; spendChanging?: boolean; blockedByOpenChange?: boolean | null };
      if (!response.ok || !payload.confirmation) throw new Error(payload.error || t('text238'));
      // Same reviewed payload and confirmation keep the same request id; any change mints a new one.
      const same = review && review.confirmation === payload.confirmation;
      setReview(same ? review : { operation, confirmation: payload.confirmation, requestId: globalThis.crypto.randomUUID(), spendChanging: payload.spendChanging !== false, blocked: payload.blockedByOpenChange !== false });
      setDialogOpen(true);
    } catch (error) { setMessage({ tone: 'error', text: error instanceof Error ? error.message : t('text238') }); }
    finally { setBusy(false); }
  }

  async function apply() {
    if (!review || busy || review.blocked) return;
    setBusy(true);
    try {
      const response = await fetch('/api/ads/management', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'apply', adAccountId, operation: review.operation, confirmation: review.confirmation, requestId: review.requestId }) });
      const payload = await response.json().catch(() => null) as { outcome?: string; message?: string; warning?: string; error?: string } | null;
      if (response.ok && payload?.outcome === 'succeeded') {
        setMessage({ tone: 'ok', text: payload.warning ?? t('adCreateSuccess') });
        setReview(null); setDialogOpen(false); setHeld(''); setName(''); setCreativeId('');
      } else if (response.ok && payload?.outcome === 'rejected') {
        setMessage({ tone: 'error', text: payload.message ?? t('text200') });
        setReview(null); setDialogOpen(false); setHeld('');
      } else {
        setHeld(payload?.message ?? payload?.error ?? t('text241')); setDialogOpen(false);
      }
    } catch { setHeld(t('networkChangeHeld')); setDialogOpen(false); }
    finally { setBusy(false); }
  }

  const locked = busy || Boolean(held);
  return <form noValidate className="ads-campaign-create" onSubmit={event => void submit(event)} aria-label={t('adCreateTitle', { adSetName })}>
    <h4>{t('adCreateTitle', { adSetName })}</h4>
    <p className="small-note">{t('adCreateDescription')}</p>
    {creatives === null ? <Button type="button" onClick={() => void loadCreatives()} disabled={busy}>{t('adCreateLoad')}</Button>
      : creatives.length === 0 ? <p className="small-note">{t('adCreateNoCreatives')}</p>
        : <div className="ads-campaign-create__fields">
          <label>{t('adCreateNameLabel')}<input {...validation.fieldProps('name')} name="name" value={name} maxLength={nameMaxCharacters} onChange={event => { setName(event.target.value); validation.clear('name'); }} disabled={locked} required /><FieldError {...validation.errorProps('name')} /></label>
          <label>{t('adCreateCreativeLabel')}<select {...validation.fieldProps('creativeId')} name="creativeId" value={creativeId} onChange={event => { setCreativeId(event.target.value); validation.clear('creativeId'); }} disabled={locked}>
            <option value="">{t('adCreateChoose')}</option>{creatives.map(item => <option key={item.id} value={item.id}>{item.name || item.title || item.id}</option>)}
          </select><FieldError {...validation.errorProps('creativeId')} /></label>
          <Button type="submit" variant="primary" disabled={locked}>{busy ? t('text208') : t('adCreateReview')}</Button>
        </div>}
    {message ? <RouteNotice error={message.tone === 'error'} className={message.tone === 'ok' ? 'small-note' : 'ui-error'} focusKey={message.text}>{localize(message.text)}</RouteNotice> : null}
    {held && review ? <div role="region" aria-label={t('adCreateHeldLabel')} className="ads-object-manager__pending">
      <p role="alert" className="ui-error">{localize(held)}</p>
      <p className="small-note">{t('text210')}<a href="/ads/manage#changes">{t('text211')}</a> {t('text212')}</p>
      <Button type="button" variant="primary" onClick={() => void apply()} disabled={busy}>{busy ? t('text118') : t('text213')}</Button>
    </div> : null}
    {review && dialogOpen ? <ModalDialog className="ui-dialog" labelledBy={`${id}-title`} onDismiss={() => { if (!busy) setDialogOpen(false); }} busy={busy}>
      <div className="ui-dialog__header"><div><h2 id={`${id}-title`}>{t('adCreateConfirmTitle')}</h2><p>{t('adCreateDescription')}</p></div></div>
      <div className="ui-dialog__body">
        {review.spendChanging ? <p role="note"><strong>{t('text120')}</strong></p> : null}
        <p><strong>{review.operation.name}</strong> {t('text224')}{adSetName}</p>
        {review.blocked ? <p role="alert">{t('text122')}<a href="/ads/manage#changes">{t('text102')}</a>{t('text251')}</p> : null}
      </div>
      <div className="ui-dialog__actions">
        <Button data-dialog-cancel onClick={() => setDialogOpen(false)} disabled={busy}>{t('text125')}</Button>
        <Button variant="primary" onClick={() => void apply()} disabled={busy || review.blocked}>{busy ? t('text126') : t('adCreateAction')}</Button>
      </div>
    </ModalDialog> : null}
  </form>;
}
