'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/Button';

/** Reversible bookkeeping, so one click rather than a typed phrase. */
export function ResolveError({ id, resolved }: { id: string; resolved: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function toggle() {
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/root/errors/${encodeURIComponent(id)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ resolved: !resolved, confirmation: `${resolved ? 'REOPEN' : 'RESOLVE'} ROOT ERROR ${id}` }) });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok || typeof payload !== 'object' || payload === null || (payload as { ok?: unknown }).ok !== true) setError('The change could not be confirmed. Reload before repeating it.');
      else router.refresh();
    } catch { setError('The change could not be confirmed. Reload before repeating it.'); } finally { setBusy(false); }
  }
  return <><Button type="button" size="sm" onClick={() => void toggle()} disabled={busy}>{busy ? 'Saving…' : resolved ? 'Reopen' : 'Mark resolved'}</Button>{error && <p role="alert" className="ui-error">{error}</p>}</>;
}
