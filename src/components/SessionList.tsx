'use client';

import { useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';

import { useConfirm } from './ConfirmProvider';
import { Icon } from './Icon';
import type { SessionView } from '@/lib/sessions';

export type SessionRow = SessionView & { user?: { id: string; name: string; email: string } };

/**
 * Signed-in browsers, one row each, with a "Sign out" per row. The person's own
 * list in Settings → Account, and everybody's in Root → Sessions (`showUser`).
 */
export function SessionList({
  sessions: initial,
  endpoint,
  showUser = false,
  onSignedOut,
}: {
  sessions: SessionRow[];
  /** Base of the DELETE route that signs one session out (`<endpoint>/<id>`). */
  endpoint: string;
  showUser?: boolean;
  onSignedOut?: (id: string) => void;
}) {
  const t = useTranslations('sessions');
  const format = useFormatter();
  const confirm = useConfirm();
  const [sessions, setSessions] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const deviceName = (row: SessionRow) =>
    row.browser && row.os
      ? t('browserOn', { browser: row.browser, os: row.os })
      : row.browser ?? row.os ?? t('unknownDevice');

  async function signOut(row: SessionRow) {
    const ok = await confirm({
      title: showUser && row.user ? t('signOutQuestionFor', { name: row.user.name }) : t('signOutQuestion'),
      body: t('signOutBody', { device: deviceName(row) }),
      confirmLabel: t('signOut'),
    });
    if (!ok) return;
    setBusy(row.id);
    setError(null);
    const response = await fetch(`${endpoint}/${row.id}`, { method: 'DELETE' }).catch(() => null);
    setBusy(null);
    if (!response?.ok) {
      const data = (await response?.json().catch(() => ({}))) as { error?: string } | undefined;
      setError(data?.error ?? t('failed'));
      return;
    }
    setSessions((list) => list.filter((entry) => entry.id !== row.id));
    onSignedOut?.(row.id);
  }

  if (sessions.length === 0) return <p className="text-sm text-slate-600">{t('empty')}</p>;

  return (
    <div className="space-y-2">
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200" aria-label={t('listLabel')}>
        {sessions.map((row) => (
          <li key={row.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
            <Icon name="globe" size={18} className="shrink-0 text-slate-500" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-slate-900">
                {deviceName(row)}
                {row.current && <span className="badge ml-2 bg-emerald-100 text-emerald-700">{t('thisBrowser')}</span>}
              </p>
              {showUser && row.user && (
                <p className="truncate text-xs text-slate-600">
                  {row.user.name} · {row.user.email}
                </p>
              )}
              <p className="text-xs text-slate-500">
                {[row.ip, row.country].filter(Boolean).join(' · ') || t('unknownPlace')}
                {' · '}
                {t('lastSeen', { when: format.relativeTime(new Date(row.lastSeenAt)) })}
              </p>
            </div>
            {!row.current && (
              <button
                type="button"
                className="btn-ghost h-9 whitespace-nowrap"
                disabled={busy === row.id}
                onClick={() => signOut(row)}
              >
                <Icon name="signOut" size={14} /> {t('signOut')}
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
