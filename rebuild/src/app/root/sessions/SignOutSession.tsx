'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/Button';
import { Dialog } from '@/components/Dialog';
import type { RootCopy } from '@/server/root/legacy/copy';

const fill = (template: string, values: Record<string, string>) => template.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match);

/** Ends one browser session after the exact typed confirmation. */
export function SignOutSession({ id, copy }: { id: string; copy: Pick<RootCopy, 'signOut' | 'signOutTitle' | 'signOutBody' | 'confirmLabel' | 'cancel' | 'working' | 'failed'> }) {
  const router = useRouter();
  const phrase = `SIGN OUT SESSION ${id}`;
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit() {
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/root/sessions/${encodeURIComponent(id)}`, { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirmation: value }) });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok || typeof payload !== 'object' || payload === null || (payload as { ok?: unknown }).ok !== true) {
        setError(typeof (payload as { error?: unknown } | null)?.error === 'string' ? (payload as { error: string }).error : copy.failed);
      } else { setOpen(false); router.refresh(); }
    } catch { setError(copy.failed); } finally { setBusy(false); }
  }
  return <>
    <Button type="button" size="sm" variant="danger" onClick={() => { setValue(''); setError(''); setOpen(true); }}>{copy.signOut}</Button>
    <Dialog open={open} title={copy.signOutTitle} onClose={() => { if (!busy) setOpen(false); }} busy={busy}
      actions={<><Button type="button" onClick={() => setOpen(false)} disabled={busy}>{copy.cancel}</Button><Button type="button" variant="danger" onClick={() => void submit()} disabled={busy || value !== phrase}>{busy ? copy.working : copy.signOut}</Button></>}>
      <p>{fill(copy.signOutBody, { phrase })}</p>
      <label className="ui-field"><span>{copy.confirmLabel}</span><input className="ui-input" value={value} onChange={event => setValue(event.target.value)} autoComplete="off" spellCheck={false} /></label>
      {error && <p role="alert" className="ui-error">{error}</p>}
    </Dialog>
  </>;
}
