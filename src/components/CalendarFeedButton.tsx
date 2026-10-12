'use client';

import { useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';

import { Dialog } from './Dialog';
import { useConfirm } from './ConfirmProvider';

interface Feed {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
}

/**
 * Calendar feed (NEXT_PHASES H19): a private address that Google Calendar or
 * Outlook subscribes to, for the Pages picked in the sidebar. Shown once;
 * revoking it stops it working.
 */
export function CalendarFeedButton({ pageIds, groupId, selection }: { pageIds: string[]; groupId: string | null; selection: string }) {
  const t = useTranslations('calendarFeed');
  const tCommon = useTranslations('common');
  const format = useFormatter();
  const confirm = useConfirm();
  const [open, setOpen] = useState(false);
  const [feeds, setFeeds] = useState<Feed[] | null>(null);
  const [created, setCreated] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function openDialog() {
    setOpen(true);
    setCreated(null);
    setError(null);
    const response = await fetch('/api/calendar-feeds').catch(() => null);
    const body = (await response?.json().catch(() => ({}))) as { feeds?: Feed[] } | undefined;
    if (!response?.ok) setError(t('loadFailed'));
    setFeeds(body?.feeds ?? []);
  }

  async function create() {
    setBusy(true);
    setError(null);
    setCopied(false);
    const response = await fetch('/api/calendar-feeds', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(groupId ? { groupId } : { pageIds }),
    }).catch(() => null);
    const body = (await response?.json().catch(() => ({}))) as { feed?: Feed; url?: string; error?: string } | undefined;
    setBusy(false);
    if (!response?.ok || !body?.feed || !body.url) {
      setError(body?.error ?? t('createFailed'));
      return;
    }
    setFeeds((current) => [body.feed!, ...(current ?? [])]);
    setCreated(body.url);
  }

  async function copy() {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  async function revoke(feed: Feed) {
    if (!(await confirm({ title: t('revokeConfirm', { name: feed.name }), body: t('revokeConfirmBody'), confirmLabel: t('revoke'), danger: true }))) return;
    const response = await fetch(`/api/calendar-feeds/${feed.id}`, { method: 'DELETE' }).catch(() => null);
    if (response?.ok) setFeeds((current) => (current ?? []).filter((entry) => entry.id !== feed.id));
    else setError(t('revokeFailed'));
  }

  const when = (iso: string) => format.dateTime(new Date(iso), { dateStyle: 'medium' });

  return (
    <>
      <button type="button" className="btn-secondary" onClick={openDialog}>
        {t('open')}
      </button>
      <Dialog open={open} title={t('title')} onClose={() => setOpen(false)} closeLabel={tCommon('close')} wide>
        <div className="space-y-4 text-sm">
          <p className="text-slate-600">{t('intro')}</p>

          {created ? (
            <div className="space-y-2 rounded-lg border border-brand-200 bg-brand-50 p-3">
              <label className="label" htmlFor="calendar-feed-url">
                {t('addressLabel')}
              </label>
              <div className="flex gap-2">
                <input id="calendar-feed-url" className="input font-mono text-xs" readOnly value={created} onFocus={(event) => event.target.select()} />
                <button type="button" className="btn-primary shrink-0" onClick={copy}>
                  {copied ? t('copied') : t('copy')}
                </button>
              </div>
              <p className="hint">{t('addressHint')}</p>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" className="btn-primary" disabled={busy} onClick={create}>
                {busy ? tCommon('working') : t('create')}
              </button>
              <span className="text-slate-600">{t('forSelection', { selection })}</span>
            </div>
          )}

          {error && (
            <p className="text-red-700" role="alert">
              {error}
            </p>
          )}

          <div>
            <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">{t('yourFeeds')}</h3>
            {feeds === null ? (
              <p className="text-slate-600">{t('loading')}</p>
            ) : feeds.length === 0 ? (
              <p className="text-slate-600">{t('none')}</p>
            ) : (
              <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200" aria-label={t('yourFeeds')}>
                {feeds.map((feed) => (
                  <li key={feed.id} className="flex items-center gap-3 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-slate-900">{feed.name}</p>
                      <p className="text-xs text-slate-500">
                        {t('createdOn', { date: when(feed.createdAt) })}
                        {' · '}
                        {feed.lastUsedAt ? t('lastRead', { date: when(feed.lastUsedAt) }) : t('neverRead')}
                      </p>
                    </div>
                    <button type="button" className="btn-secondary text-sm" onClick={() => revoke(feed)}>
                      {t('revoke')}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </Dialog>
    </>
  );
}
