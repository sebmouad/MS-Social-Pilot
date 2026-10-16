'use client';

import { useState, type FormEvent } from 'react';
import { ModalDialog } from '@/components/ModalDialog';
import { FieldError, useFormValidation } from '@/components/FormValidation';
import { fillAdsTemplate as fill, type AdsUiSchema } from '@/platforms/ads-ui';

type Config = NonNullable<AdsUiSchema['campaign']>;

export function CampaignCreateForm({ adAccountId, accountName, config }: { adAccountId: string; accountName: string; config: Config }) {
  const [name, setName] = useState('');
  const [objective, setObjective] = useState(config.defaultOption);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [dialogError, setDialogError] = useState('');
  const validation = useFormValidation();

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const cleanName = name.trim();
    const customErrors = !cleanName || cleanName.length > config.nameMaxLength
      ? { name: `Enter a campaign name from 1 to ${config.nameMaxLength} characters.` }
      : undefined;
    if (!validation.validate(event.currentTarget, customErrors)) { setMessage('Correct the highlighted field to continue.'); return; }
    setDialogError('');
    setConfirming(true);
  }

  async function confirmCreate() {
    const cleanName = name.trim();
    const confirmation = fill(config.confirmationTemplate, { nameJson: JSON.stringify(cleanName), adAccountId, objective });
    setBusy(true); setMessage(''); setDialogError('');
    try {
      const response = await fetch('/api/ads/campaigns', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ adAccountId, name: cleanName, objective, confirmation }) });
      const payload = await response.json().catch(() => ({})) as { error?: string; campaignId?: string; auditRecorded?: boolean; warning?: string };
      if (!response.ok) throw new Error(payload.error || 'The campaign could not be created.');
      setMessage(payload.auditRecorded === false
        ? `Paused campaign created (${payload.campaignId}). ${payload.warning || 'Its audit record could not be saved. Do not submit this creation again.'}`
        : `Paused campaign created (${payload.campaignId}).`);
      setName(''); setConfirming(false);
    } catch (error) { setDialogError(error instanceof Error ? error.message : 'The campaign could not be created.'); }
    finally { setBusy(false); }
  }

  return <form method="post" noValidate className="ads-campaign-create" onSubmit={create} aria-label={`Create campaign in ${accountName}`}>
    <h3>{config.title}</h3>
    <p className="small-note">{config.description}</p>
    <div className="ads-campaign-create__fields">
      <label>{config.nameLabel}<input name="name" value={name} onChange={event => setName(event.target.value)} maxLength={config.nameMaxLength} required disabled={busy} {...validation.fieldProps('name')} /><FieldError {...validation.errorProps('name')} /></label>
      <label>{config.optionLabel}<select value={objective} onChange={event => setObjective(event.target.value)} disabled={busy}>{config.options.map(({value, label}) => <option key={value} value={value}>{label}</option>)}</select></label>
      <button type="submit" disabled={busy}>{busy ? 'Creating…' : config.actionLabel}</button>
    </div>
    {message ? <p role="status" className="small-note">{message}</p> : null}
    {confirming ? <ModalDialog className="ui-dialog" labelledBy={`campaign-confirm-${adAccountId}`} onDismiss={() => { if (!busy) setConfirming(false); }} busy={busy}>
      <div className="ui-dialog__header"><div><h2 id={`campaign-confirm-${adAccountId}`}>{config.confirmTitle}</h2><p>{config.confirmDescription}</p></div></div>
      <div className="ui-dialog__body"><p><strong>{name.trim()}</strong> · {config.options.find(option => option.value === objective)?.label ?? objective} · {accountName}</p>{dialogError && <p role="alert" className="ui-error">{dialogError}</p>}</div>
      <div className="ui-dialog__actions"><button type="button" data-dialog-cancel onClick={() => setConfirming(false)} disabled={busy}>Cancel</button><button type="button" onClick={() => void confirmCreate()} disabled={busy}>{busy ? 'Creating…' : config.actionLabel}</button></div>
    </ModalDialog> : null}
  </form>;
}
