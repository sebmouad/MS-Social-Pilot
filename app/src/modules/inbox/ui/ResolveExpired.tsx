'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { IconClockOff } from '@tabler/icons-react';
import { useConfirm } from '@/components/useConfirm';
import { bulkConfirmation } from '@/modules/inbox/bulk';

/**
 * Open Messenger conversations past Facebook's reply window can no longer be answered (2026-11-14): one action resolves
 * them all through the same bulk route as the list's « Resolve », in batches of the bulk limit, with progress.
 */
export function ResolveExpired({ ids, batch, locale }: { ids: string[]; batch: number; locale: 'en' | 'fr' }) {
  const fr = locale === 'fr';
  const router = useRouter();
  const [done, setDone] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirm, dialog] = useConfirm({ title: fr ? 'Résoudre les conversations expirées ?' : 'Resolve expired conversations?', cancel: fr ? 'Annuler' : 'Cancel', confirm: fr ? 'Résoudre' : 'Resolve', danger: false });
  if (!ids.length) return null;
  async function run() {
    if (!(await confirm(fr ? `${ids.length} conversations Messenger ne peuvent plus recevoir de réponse (fenêtre de réponse fermée). Elles passent en « Résolu » ; vous pourrez les rouvrir.` : `${ids.length} Messenger conversations can no longer be answered (reply window closed). They move to Resolved; you can reopen any of them.`))) return;
    setBusy(true); setError(''); setDone(0);
    let count = 0;
    try {
      for (let start = 0; start < ids.length; start += batch) {
        const items = ids.slice(start, start + batch).map(id => ({ kind: 'message' as const, id }));
        const response = await fetch('/api/inbox/bulk', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'resolve', items, confirmation: bulkConfirmation('resolve', items.length) }) });
        const body = await response.json().catch(() => null) as { succeeded?: number; error?: string } | null;
        if (!response.ok) throw new Error(body?.error || (fr ? 'La résolution a échoué.' : 'Resolving failed.'));
        count += body?.succeeded ?? 0; setDone(count);
      }
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    setBusy(false); router.refresh();
  }
  return <div className="inbox-expired" role="status">
    <IconClockOff size={18} aria-hidden="true" />
    <span>{busy ? (fr ? `Résolution… ${done} / ${ids.length}` : `Resolving… ${done} / ${ids.length}`) : fr ? `${ids.length} conversations ne peuvent plus recevoir de réponse (fenêtre Messenger fermée).` : `${ids.length} conversations can no longer be answered (Messenger reply window closed).`}</span>
    {error ? <span className="ui-error">{error}</span> : null}
    <button type="button" className="ui-button ui-button--secondary ui-button--sm" disabled={busy} onClick={() => void run()}>{fr ? 'Les résoudre' : 'Resolve them'}</button>
    {dialog}
  </div>;
}
