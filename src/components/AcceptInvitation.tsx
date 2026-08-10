'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useTranslations } from 'next-intl';

export function AcceptInvitation({ token, label }: { token: string; label: string }) {
  const t = useTranslations('team');
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function accept() {
    setPending(true);
    setError(null);

    const response = await fetch('/api/team/accept', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? t('acceptInvalid'));
      setPending(false);
      return;
    }

    // Accepting switches the active workspace, so the whole shell re-renders.
    router.refresh();
    router.push('/dashboard');
  }

  return (
    <div className="mt-5">
      {error && (
        <p className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
      <button type="button" className="btn-primary" onClick={accept} disabled={pending}>
        {label}
      </button>
    </div>
  );
}
