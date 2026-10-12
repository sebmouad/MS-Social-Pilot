'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

export interface NotificationPreferences {
  onPublishFailure: boolean;
  onTokenExpiry: boolean;
  onApprovalRequest: boolean;
  onApprovalDecision: boolean;
  onNewInbox: boolean;
  onQueueEmpty: boolean;
  onDraftUpdated: boolean;
  onModerationAlert: boolean;
}

/** Events a member can switch off for one Page (mirrors `PAGE_EVENTS` on the server). */
const PAGE_EVENTS = ['publishFailure', 'newInbox', 'queueEmpty'] as const;

export function NotificationsClient({
  initial,
  emailConfigured,
  pages,
  initialMutes,
}: {
  initial: NotificationPreferences;
  emailConfigured: boolean;
  /** The member's Pages in this workspace. */
  pages: Array<{ id: string; name: string }>;
  /** `targetId:event` pairs switched off. */
  initialMutes: string[];
}) {
  const t = useTranslations('notifications');
  const tCommon = useTranslations('common');

  const [preferences, setPreferences] = useState(initial);
  const [mutes, setMutes] = useState(() => new Set(initialMutes));
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rows: Array<{ key: keyof NotificationPreferences; label: string }> = [
    { key: 'onPublishFailure', label: t('onPublishFailure') },
    { key: 'onTokenExpiry', label: t('onTokenExpiry') },
    { key: 'onApprovalRequest', label: t('onApprovalRequest') },
    { key: 'onApprovalDecision', label: t('onApprovalDecision') },
    { key: 'onNewInbox', label: t('onNewInbox') },
    { key: 'onQueueEmpty', label: t('onQueueEmpty') },
    { key: 'onDraftUpdated', label: t('onDraftUpdated') },
    { key: 'onModerationAlert', label: t('onModerationAlert') },
  ];
  const columns: Array<{ event: (typeof PAGE_EVENTS)[number]; label: string; on: boolean }> = [
    { event: 'publishFailure', label: t('pageEvent_publishFailure'), on: preferences.onPublishFailure },
    { event: 'newInbox', label: t('pageEvent_newInbox'), on: preferences.onNewInbox },
    { event: 'queueEmpty', label: t('pageEvent_queueEmpty'), on: preferences.onQueueEmpty },
  ];

  async function save() {
    setPending(true);
    setSaved(false);
    setError(null);
    try {
      const response = await fetch('/api/notifications', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...preferences,
          mutes: [...mutes].map((key) => {
            const [targetId, event] = key.split(':');
            return { targetId, event };
          }),
        }),
      });
      // "Saved" after a refusal is the worst answer here: the person stops
      // watching for failures on the strength of an email that will never come.
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? t('saveFailed'));
        return;
      }
      setSaved(true);
    } catch {
      setError(t('networkError'));
    } finally {
      setPending(false);
    }
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

      {pages.length > 0 && (
        <div className="mt-6">
          <h2 className="text-sm font-semibold text-slate-900">{t('perPageTitle')}</h2>
          <p className="mt-1 text-xs text-slate-600">{t('perPageHint')}</p>
          <div className="scroll-x mt-3">
            <table className="w-full min-w-[22rem] text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500">
                  <th scope="col" className="py-2 pr-3 font-medium">{t('perPagePage')}</th>
                  {columns.map((column) => (
                    <th key={column.event} scope="col" className="px-3 py-2 text-center font-medium">
                      {column.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {pages.map((page) => (
                  <tr key={page.id}>
                    <th scope="row" className="py-2 pr-3 text-left font-normal text-slate-800">{page.name}</th>
                    {columns.map((column) => {
                      const key = `${page.id}:${column.event}`;
                      return (
                        <td key={column.event} className="px-3 py-2 text-center">
                          <input
                            type="checkbox"
                            aria-label={t('perPageToggle', { event: column.label, page: page.name })}
                            className="h-4 w-4 rounded border-slate-300 text-brand-500 focus:ring-brand-500 disabled:opacity-40"
                            disabled={!column.on}
                            checked={column.on && !mutes.has(key)}
                            onChange={(event) => {
                              const next = new Set(mutes);
                              if (event.target.checked) next.delete(key);
                              else next.add(key);
                              setMutes(next);
                            }}
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button type="button" className="btn-primary" onClick={save} disabled={pending}>
          {pending ? tCommon('working') : tCommon('save')}
        </button>
        {saved && (
          <span role="status" className="text-sm text-emerald-600">
            {t('saved')}
          </span>
        )}
        {error && (
          <span role="alert" className="text-sm text-red-600">
            {error}
          </span>
        )}
      </div>
    </section>
  );
}
