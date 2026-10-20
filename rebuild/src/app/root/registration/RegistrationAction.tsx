'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/Button';
import { useConfirm } from '@/components/useConfirm';
import type { RegistrationCopy } from './copy';

type Props = { id: string; email: string; action: 'revoke' | 'resend' | 'delete'; workspaceId?: string; workspaceName?: string; copy: RegistrationCopy };
export function RegistrationAction({ id, email, action, workspaceId, workspaceName, copy: t }: Props) {
  const router = useRouter();
  const [notice, setNotice] = useState('');
  const [confirm, dialog] = useConfirm({ title: t[action], cancel: t.cancel, confirm: t[action], danger: action !== 'resend' });
  const phrase = action === 'revoke' ? `REVOKE INVITATION ${id}` : `${action === 'resend' ? 'RESEND VERIFICATION' : 'DELETE UNVERIFIED ACCOUNT'} ${id}`;
  async function run() {
    setNotice('');
    await confirm(t[`${action}Body`].replace('{email}', email).replace('{workspace}', workspaceName ?? workspaceId ?? t.unavailable), {
      exactConfirmation: phrase, confirmationLabel: t.type, pendingLabel: t.working, failureLabel: t.failed,
      onConfirm: async () => {
        const response = await fetch(`/api/root/registration/${action === 'revoke' ? 'invitations' : 'accounts'}/${encodeURIComponent(id)}`, {
          method: action === 'resend' ? 'POST' : 'DELETE', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ confirmation: phrase, ...(action === 'revoke' ? { workspaceId } : {}) }),
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok || payload?.ok !== true) return t.failed;
        if (action === 'revoke' ? payload.id !== id || payload.workspaceId !== workspaceId : payload.userId !== id) return t.failed;
        if (action === 'resend' && payload.delivery !== 'sent') return t.uncertain;
        if (action === 'revoke' && payload.revoked !== true || action === 'delete' && payload.deleted !== true) return t.failed;
        setNotice(action === 'resend' ? t.sent : action === 'delete' ? t.removed : t.revoked);
        router.refresh(); return null;
      },
    });
  }
  return <><Button size="sm" variant={action === 'resend' ? 'secondary' : 'danger'} onClick={() => void run()}>{t[action]}</Button>{dialog}{notice && <p role="status">{notice}</p>}</>;
}
