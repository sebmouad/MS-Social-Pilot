'use client';

import { useState } from 'react';

type Props = { adAccountId: string; objectId: string; objectType: 'campaign' | 'adset' | 'ad' };

export function AdsObjectActions({ adAccountId, objectId, objectType }: Props) {
  const [budgetMinor, setBudgetMinor] = useState('');
  const [budgetKind, setBudgetKind] = useState<'daily' | 'lifetime'>('daily');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  async function submit(change: { status: 'active' | 'paused' } | { dailyBudgetMinor: number } | { lifetimeBudgetMinor: number }, confirmation: string) {
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch('/api/ads/actions', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ adAccountId, objectId, objectType, ...change, confirmation }),
      });
      const payload = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(payload.error || 'The ads action could not be completed.');
      setMessage('Change saved.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The ads action could not be completed.');
    } finally { setBusy(false); }
  }

  function changeStatus(status: 'active' | 'paused') {
    const confirmation = `SET AD STATUS ${objectId} TO ${status.toUpperCase()}`;
    const entered = window.prompt(`This changes ad delivery. Type this exact confirmation to continue:\n\n${confirmation}`);
    if (entered === confirmation) void submit({ status }, entered);
  }

  function changeBudget() {
    const amount = Number(budgetMinor);
    if (!Number.isSafeInteger(amount) || amount < 1) {
      setMessage('Enter a positive whole amount in minor currency units.');
      return;
    }
    const confirmation = `SET AD BUDGET ${objectId} TO ${amount} MINOR UNITS`;
    const entered = window.prompt(`This can change campaign spend. Type this exact confirmation to continue:\n\n${confirmation}`);
    if (entered === confirmation) void submit(budgetKind === 'daily' ? { dailyBudgetMinor: amount } : { lifetimeBudgetMinor: amount }, entered);
  }

  return <div className="ads-object-actions" aria-label={`Manage ${objectType} ${objectId}`}>
    <div className="ads-object-actions__status">
      <button type="button" disabled={busy} onClick={() => changeStatus('paused')}>Pause</button>
      <button type="button" disabled={busy} onClick={() => changeStatus('active')}>Resume</button>
    </div>
    <form className="ads-object-actions__budget" onSubmit={event => { event.preventDefault(); changeBudget(); }}>
      <label><span className="sr-only">Budget period</span><select value={budgetKind} onChange={event => setBudgetKind(event.target.value as 'daily' | 'lifetime')} disabled={busy}>
        <option value="daily">Daily</option><option value="lifetime">Lifetime</option>
      </select></label>
      <label><span className="sr-only">New budget in minor units</span><input aria-label="New budget in minor units" type="number" min="1" step="1" inputMode="numeric" placeholder="Minor units" value={budgetMinor} onChange={event => setBudgetMinor(event.target.value)} disabled={busy} /></label>
      <button type="submit" disabled={busy}>Set budget</button>
    </form>
    {message ? <p role="status" className="small-note">{message}</p> : null}
  </div>;
}
