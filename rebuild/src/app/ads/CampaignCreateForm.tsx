'use client';

import { useState, type FormEvent } from 'react';
import { ModalDialog } from '@/components/ModalDialog';

const objectives = [
  ['OUTCOME_AWARENESS', 'Awareness'], ['OUTCOME_ENGAGEMENT', 'Engagement'], ['OUTCOME_LEADS', 'Leads'],
  ['OUTCOME_SALES', 'Sales'], ['OUTCOME_TRAFFIC', 'Traffic'], ['OUTCOME_APP_PROMOTION', 'App promotion'],
] as const;

export function CampaignCreateForm({ adAccountId, accountName }: { adAccountId: string; accountName: string }) {
  const [name, setName] = useState('');
  const [objective, setObjective] = useState<(typeof objectives)[number][0]>('OUTCOME_TRAFFIC');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [confirming, setConfirming] = useState(false);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanName = name.trim();
    if (!cleanName || cleanName.length > 100) { setMessage('Enter a campaign name from 1 to 100 characters.'); return; }
    setConfirming(true);
  }

  async function confirmCreate() {
    const cleanName = name.trim();
    const confirmation = `CREATE PAUSED FACEBOOK CAMPAIGN ${JSON.stringify(cleanName)} IN ACCOUNT ${adAccountId} WITH OBJECTIVE ${objective}`;
    setBusy(true); setMessage('');
    try {
      const response = await fetch('/api/ads/campaigns', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ adAccountId, name: cleanName, objective, confirmation }) });
      const payload = await response.json().catch(() => ({})) as { error?: string; campaignId?: string };
      if (!response.ok) throw new Error(payload.error || 'The campaign could not be created.');
      setMessage(`Paused campaign created (${payload.campaignId}).`); setName(''); setConfirming(false);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'The campaign could not be created.'); setConfirming(false); }
    finally { setBusy(false); }
  }

  return <form method="post" className="ads-campaign-create" onSubmit={create} aria-label={`Create campaign in ${accountName}`}>
    <h3>Create paused campaign</h3>
    <p className="small-note">This creates a draft campaign only. Add an ad set and ads in Meta Ads Manager before activating delivery.</p>
    <div className="ads-campaign-create__fields">
      <label>Campaign name<input value={name} onChange={event => setName(event.target.value)} maxLength={100} required disabled={busy} /></label>
      <label>Objective<select value={objective} onChange={event => setObjective(event.target.value as typeof objective)} disabled={busy}>{objectives.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <button type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create paused campaign'}</button>
    </div>
    {message ? <p role="status" className="small-note">{message}</p> : null}
    {confirming ? <ModalDialog className="ui-dialog" labelledBy={`campaign-confirm-${adAccountId}`} onDismiss={() => { if (!busy) setConfirming(false); }} busy={busy}>
      <div className="ui-dialog__header"><div><h2 id={`campaign-confirm-${adAccountId}`}>Create this paused campaign?</h2><p>It will not deliver until activated separately.</p></div></div>
      <div className="ui-dialog__body"><p><strong>{name.trim()}</strong> · {objectives.find(([value]) => value === objective)?.[1]} · {accountName}</p></div>
      <div className="ui-dialog__actions"><button type="button" data-dialog-cancel onClick={() => setConfirming(false)} disabled={busy}>Cancel</button><button type="button" onClick={() => void confirmCreate()} disabled={busy}>{busy ? 'Creating…' : 'Create paused campaign'}</button></div>
    </ModalDialog> : null}
  </form>;
}
