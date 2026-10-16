'use client';

import { useId, useState } from 'react';
import { ModalDialog } from '@/components/ModalDialog';
import { FieldError, useFormValidation } from '@/components/FormValidation';
import { budgetFractionDigits, formatBudgetMinor, parseBudgetAmount } from './budget';

type Change = { status: 'active' | 'paused' } | { dailyBudgetMinor: number } | { lifetimeBudgetMinor: number };
type PendingChange = { change: Change; confirmation: string; description: string };
type Props = { adAccountId: string; objectId: string; objectType: 'campaign' | 'adset' | 'ad'; currency: string | null; canRead: boolean; canManage: boolean };

export function AdsObjectActions({ adAccountId, objectId, objectType, currency, canRead, canManage }: Props) {
  const [budgetAmount, setBudgetAmount] = useState('');
  const [budgetKind, setBudgetKind] = useState<'daily' | 'lifetime'>('daily');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [liveStatus, setLiveStatus] = useState('');
  const [pending, setPending] = useState<PendingChange | null>(null);
  const dialogId = useId();
  const validation = useFormValidation();

  async function refreshStatus() {
    setBusy(true); setMessage(''); setLiveStatus('');
    try {
      const response = await fetch('/api/ads/object', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ adAccountId, objectId, objectType }),
      });
      const payload = await response.json().catch(() => ({})) as {
        error?: string;
        object?: { configuredStatus: string | null; effectiveStatus: string | null };
      };
      if (!response.ok || !payload.object) throw new Error(payload.error || 'The live ad status could not be read.');
      setLiveStatus(`Live status: ${payload.object.configuredStatus ?? 'unknown'} · effective: ${payload.object.effectiveStatus ?? 'unknown'}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The live ad status could not be read.');
    } finally { setBusy(false); }
  }

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
      setMessage('Change saved.'); setPending(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The ads action could not be completed.');
      setPending(null);
    } finally { setBusy(false); }
  }

  function changeStatus(status: 'active' | 'paused') {
    const confirmation = `SET AD STATUS ${objectId} TO ${status.toUpperCase()}`;
    setPending({ change: { status }, confirmation, description: `${status === 'paused' ? 'Pause' : 'Resume'} delivery for this ${objectType}.` });
  }

  function changeBudget(form: HTMLFormElement) {
    if (busy) return;
    const amount = parseBudgetAmount(budgetAmount, currency);
    const customErrors = amount === null
      ? { budgetAmount: `Enter a valid amount${currency ? ` in ${currency}` : ''} with up to ${budgetFractionDigits(currency)} decimal places.` }
      : undefined;
    if (!validation.validate(form, customErrors)) return;
    if (amount === null) return;
    const confirmation = `SET AD BUDGET ${objectId} TO ${amount} MINOR UNITS`;
    setPending({
      change: budgetKind === 'daily' ? { dailyBudgetMinor: amount } : { lifetimeBudgetMinor: amount },
      confirmation,
      description: `Set the ${budgetKind} budget to ${formatBudgetMinor(amount, currency)} for this ${objectType}.`,
    });
  }

  return <div className="ads-object-actions" aria-label={`Manage ${objectType} ${objectId}`}>
    {canRead ? <div className="ads-object-actions__status">
      <button type="button" disabled={busy} onClick={() => void refreshStatus()}>Refresh live status</button>
    </div> : null}
    {canManage ? <>
      <div className="ads-object-actions__status">
        <button type="button" disabled={busy} onClick={() => changeStatus('paused')}>Pause</button>
        <button type="button" disabled={busy} onClick={() => changeStatus('active')}>Resume</button>
      </div>
      <form method="post" noValidate className="ads-object-actions__budget" onSubmit={event => { event.preventDefault(); changeBudget(event.currentTarget); }}>
        <label><span className="sr-only">Budget period</span><select value={budgetKind} onChange={event => setBudgetKind(event.target.value as 'daily' | 'lifetime')} disabled={busy}>
          <option value="daily">Daily</option><option value="lifetime">Lifetime</option>
        </select></label>
        <label><span className="sr-only">New {budgetKind} budget{currency ? ` in ${currency}` : ''}</span><input name="budgetAmount" aria-label={`New ${budgetKind} budget${currency ? ` in ${currency}` : ''}`} type="number" min={10 ** -budgetFractionDigits(currency)} step={10 ** -budgetFractionDigits(currency)} inputMode="decimal" placeholder={currency ?? 'Amount'} value={budgetAmount} onChange={event => setBudgetAmount(event.target.value)} required disabled={busy} {...validation.fieldProps('budgetAmount')} /><FieldError {...validation.errorProps('budgetAmount')} /></label>
        <button type="submit" disabled={busy}>Set budget</button>
      </form>
    </> : null}
    {liveStatus ? <p role="status" className="small-note">{liveStatus}</p> : null}
    {message ? <p role="status" className="small-note">{message}</p> : null}
    {pending ? <ModalDialog className="ui-dialog" labelledBy={`ads-action-title-${dialogId}`} onDismiss={() => { if (!busy) setPending(null); }} busy={busy}>
      <div className="ui-dialog__header"><div><h2 id={`ads-action-title-${dialogId}`}>Confirm ad change</h2><p>{pending.description}</p></div></div>
      <div className="ui-dialog__body"><p>Target: {objectType} · {objectId}</p></div>
      <div className="ui-dialog__actions"><button type="button" data-dialog-cancel onClick={() => setPending(null)} disabled={busy}>Cancel</button><button type="button" onClick={() => void submit(pending.change, pending.confirmation)} disabled={busy}>{busy ? 'Saving…' : 'Confirm change'}</button></div>
    </ModalDialog> : null}
  </div>;
}
