'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/Button';
import { useConfirm } from '@/components/useConfirm';
import { fill, rootCopy, type RootCopyLocale } from '@/modules/root/server/admin/copy';

export function RefreshConnection({ id, name, locale }: { id: string; name: string; locale: RootCopyLocale }) {
  const t = rootCopy(locale);
  const router = useRouter();
  const [notice, setNotice] = useState('');
  const [ask, dialog] = useConfirm({ title: fill(t.refreshTitle, { name }), cancel: t.cancel, confirm: t.refresh, danger: false });
  async function refresh() {
    setNotice('');
    await ask(t.refreshBody, {
      exactConfirmation: `REFRESH CONNECTION ${id}`, confirmationLabel: t.confirmLabel,
      pendingLabel: t.refreshPending, failureLabel: t.refreshUnconfirmed,
      onConfirm: async () => {
        const response = await fetch(`/api/root/connections/${encodeURIComponent(id)}/refresh`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirmation: `REFRESH CONNECTION ${id}` }) });
        const result = await response.json().catch(() => null);
        if (!response.ok || response.redirected || result?.ok !== true) return t.refreshUnconfirmed;
        const message = result.outcome === 'renewed' ? t.refreshRenewed : result.outcome === 'not_renewable' ? t.refreshNotRenewable : result.outcome === 'failed' ? t.refreshFailed : null;
        if (!message) return t.refreshUnconfirmed;
        setNotice(message);
        router.refresh();
        return null;
      },
    });
  }
  return <><Button type="button" size="sm" onClick={() => void refresh()}>{t.refresh}</Button>{notice && <p role="status" aria-live="polite">{notice}</p>}{dialog}</>;
}
