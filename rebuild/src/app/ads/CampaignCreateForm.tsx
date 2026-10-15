'use client';

import { useState, type FormEvent } from 'react';

const objectives = [
  ['OUTCOME_AWARENESS', 'Awareness'], ['OUTCOME_ENGAGEMENT', 'Engagement'], ['OUTCOME_LEADS', 'Leads'],
  ['OUTCOME_SALES', 'Sales'], ['OUTCOME_TRAFFIC', 'Traffic'], ['OUTCOME_APP_PROMOTION', 'App promotion'],
] as const;

export function CampaignCreateForm({ adAccountId, accountName }: { adAccountId: string; accountName: string }) {
  const [name, setName] = useState('');
  const [objective, setObjective] = useState<(typeof objectives)[number][0]>('OUTCOME_TRAFFIC');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanName = name.trim();
    if (!cleanName || cleanName.length > 100) { setMessage('Enter a campaign name from 1 to 100 characters.'); return; }
    const confirmation = `CREATE PAUSED FACEBOOK CAMPAIGN ${JSON.stringify(cleanName)} IN ACCOUNT ${adAccountId} WITH OBJECTIVE ${objective}`;
    const entered = window.prompt(`This creates a Facebook campaign in a paused state. It will not deliver until separately activated. Type this exact confirmation to continue:\n\n${confirmation}`);
    if (entered !== confirmation) return;
    setBusy(true); setMessage('');
    try {
      const response = await fetch('/api/ads/campaigns', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ adAccountId, name: cleanName, objective, confirmation: entered }) });
      const payload = await response.json().catch(() => ({})) as { error?: string; campaignId?: string };
      if (!response.ok) throw new Error(payload.error || 'The campaign could not be created.');
      setMessage(`Paused campaign created (${payload.campaignId}).`); setName('');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'The campaign could not be created.'); }
    finally { setBusy(false); }
  }

  return <form className="ads-campaign-create" onSubmit={create} aria-label={`Create campaign in ${accountName}`}>
    <h3>Create paused campaign</h3>
    <p className="small-note">This creates a draft campaign only. Add an ad set and ads in Meta Ads Manager before activating delivery.</p>
    <div className="ads-campaign-create__fields">
      <label>Campaign name<input value={name} onChange={event => setName(event.target.value)} maxLength={100} required disabled={busy} /></label>
      <label>Objective<select value={objective} onChange={event => setObjective(event.target.value as typeof objective)} disabled={busy}>{objectives.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <button type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create paused campaign'}</button>
    </div>
    {message ? <p role="status" className="small-note">{message}</p> : null}
  </form>;
}
