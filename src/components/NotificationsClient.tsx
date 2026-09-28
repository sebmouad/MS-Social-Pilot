'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

export interface NotificationPreferences {
  onPublishFailure: boolean;
  onTokenExpiry: boolean;
  onApprovalRequest: boolean;
  onApprovalDecision: boolean;
}

export function NotificationsClient({
  initial,
  emailConfigured,
}: {
  initial: NotificationPreferences;
  emailConfigured: boolean;
}) {
  const t = useTranslations('notifications');
  const tCommon = useTranslations('common');

  const [preferences, setPreferences] = useState(initial);
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const [failed, setFailed] = useState(false);

  const rows: Array<{ key: keyof NotificationPreferences; label: string }> = [
    { key: 'onPublishFailure', label: t('onPublishFailure') },
    { key: 'onTokenExpiry', label: t('onTokenExpiry') },
    { key: 'onApprovalRequest', label: t('onApprovalRequest') },
    { key: 'onApprovalDecision', label: t('onApprovalDecision') },
  ];

  async function save() {
    setPending(true);
    setSaved(false);
    setFailed(false);
    // Said "saved" whatever happened, including a 401 from an expired session
    // or no network at all — the one outcome a preferences screen must not
    // claim is one where nothing was saved.
    const response = await fetch('/api/notifications', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(preferences),
    }).catch(() => null);
    setPending(false);
    if (response?.ok) setSaved(true);
    else setFailed(true);
  }

  return (
    <section className="card p-5">
      {!emailConfigured && (
        <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {t('noEmailProvider')}
        </p>
      )}

      <ul className="space-y-3">
        {rows.map((row) => (
          <li key={row.key}>
            <label className="flex items-center gap-3 text-sm text-slate-700">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-slate-300 text-brand-500 focus:ring-brand-500"
                checked={preferences[row.key]}
                onChange={(event) =>
                  setPreferences({ ...preferences, [row.key]: event.target.checked })
                }
              />
              {row.label}
            </label>
          </li>
        ))}
      </ul>

      <div className="mt-5 flex items-center gap-3">
        <button type="button" className="btn-primary" onClick={save} disabled={pending}>
          {pending ? tCommon('working') : tCommon('save')}
        </button>
        {saved && <span className="text-sm text-emerald-600">{t('saved')}</span>}
        {failed && (
          <span role="alert" className="text-sm text-red-600">
            {t('saveFailed')}
          </span>
        )}
      </div>
    </section>
  );
}
