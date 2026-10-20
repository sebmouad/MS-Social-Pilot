'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/Button';
import { useConfirm } from '@/components/useConfirm';
import { fill, rootCopy, type RootCopyLocale } from '@/server/root/legacy/copy';

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
const COUNT_KEYS = ['channels', 'adAccounts', 'postTargets', 'orphanPosts', 'comments', 'conversations', 'conversationMessages', 'pageInsights', 'adInsights', 'scheduledRemote'] as const;

/** Disconnect with deletion of the related local records: shows the counted consequences first, then asks for the exact phrase. */
export function DeleteConnectionData({ id, name, locale }: { id: string; name: string; locale: RootCopyLocale }) {
  const t = rootCopy(locale);
  const router = useRouter();
  const [notice, setNotice] = useState('');
  const [failure, setFailure] = useState('');
  const phrase = `DELETE CONNECTION DATA ${id}`;
  const [ask, dialog] = useConfirm({ title: fill(t.deleteDataTitle, { name }), cancel: t.cancel, confirm: t.deleteData });
  async function start() {
    setNotice(''); setFailure('');
    const response = await fetch(`/api/root/connections/${encodeURIComponent(id)}`, { method: 'GET' }).catch(() => null);
    const payload: unknown = await response?.json().catch(() => null);
    const counts = isRecord(payload) && payload.ok === true && isRecord(payload.counts) ? payload.counts : null;
    if (!response?.ok || !counts || COUNT_KEYS.some(key => typeof counts[key] !== 'number')) { setFailure(t.deleteDataPreviewFailed); return; }
    const n = (key: (typeof COUNT_KEYS)[number]) => Number(counts[key]);
    const summary = fill(t.deleteDataCounts, Object.fromEntries(COUNT_KEYS.map(key => [key, n(key)])));
    const scheduled = n('scheduledRemote') > 0 ? ` ${fill(t.deleteDataScheduled, { count: n('scheduledRemote') })}` : '';
    await ask(`${t.deleteDataBody} ${summary}${scheduled}`, {
      exactConfirmation: phrase, confirmationLabel: t.confirmLabel, pendingLabel: t.deleteDataPending, failureLabel: t.deleteDataUnconfirmed,
      onConfirm: async () => {
        const result = await fetch(`/api/root/connections/${encodeURIComponent(id)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirmation: phrase, mode: 'delete' }) });
        const body: unknown = await result.json().catch(() => null);
        if (!result.ok || result.redirected || !isRecord(body) || body.ok !== true) return isRecord(body) && body.code === 'conflict' && typeof body.error === 'string' ? body.error : t.deleteDataUnconfirmed;
        setNotice(t.deleteDataDone);
        router.refresh();
        return null;
      },
    });
  }
  return <><Button type="button" size="sm" variant="danger" onClick={() => void start()}>{t.deleteData}</Button>{notice && <p role="status" aria-live="polite">{notice}</p>}{failure && <p role="alert">{failure}</p>}{dialog}</>;
}
