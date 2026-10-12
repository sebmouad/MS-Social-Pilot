'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

import { Icon } from './Icon';

/** Mark one comment or conversation done for the whole team, or open it again. */
export function InboxResolveButton({ kind, id, resolved }: { kind: 'comment' | 'message'; id: string; resolved: boolean }) {
  const t = useTranslations('inbox');
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        className="btn-secondary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setFailed(false);
          try {
            const response = await fetch('/api/inbox', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ kind, id, resolved: !resolved }),
            });
            if (!response.ok) throw new Error();
            router.refresh();
          } catch {
            setFailed(true);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Icon name={resolved ? 'refresh' : 'check'} size={14} /> {resolved ? t('reopen') : t('markDone')}
      </button>
      {failed && (
        <span role="alert" className="text-xs text-red-700">
          {t('failed')}
        </span>
      )}
    </span>
  );
}
