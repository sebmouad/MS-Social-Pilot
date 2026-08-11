'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useTranslations } from 'next-intl';

import type { TargetOption } from './TargetPicker';
import { ExternalLink } from './ExternalLink';

export interface FeedView {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  autoApprove: boolean;
  messageTemplate: string;
  targetIds: string[];
  lastPolledLabel: string | null;
  lastError: string | null;
  pollErrorCount: number;
  itemCount: number;
}

interface Props {
  feeds: FeedView[];
  targets: TargetOption[];
  canManage: boolean;
}

export function FeedsClient({ feeds, targets, canManage }: Props) {
  const t = useTranslations('feeds');
  const tCommon = useTranslations('common');
  const router = useRouter();

  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [template, setTemplate] = useState('{{title}}\n\n{{link}}');
  const [selected, setSelected] = useState<string[]>([]);
  const [autoApprove, setAutoApprove] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function call(path: string, init: RequestInit): Promise<unknown | null> {
    setError(null);
    setNotice(null);
    const response = await fetch(path, init);
    const body = (await response.json().catch(() => ({}))) as Record<string, unknown> & {
      error?: string;
      fields?: Record<string, string>;
    };
    if (!response.ok) {
      setError(body.fields ? Object.values(body.fields)[0]! : body.error ?? tCommon('working'));
      return null;
    }
    router.refresh();
    return body;
  }

  async function create() {
    setPending(true);
    const result = await call('/api/feeds', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name,
        url,
        messageTemplate: template,
        targetIds: selected,
        autoApprove,
      }),
    });
    if (result) {
      setAdding(false);
      setName('');
      setUrl('');
      setSelected([]);
    }
    setPending(false);
  }

  async function pollNow(id: string) {
    setPending(true);
    const result = (await call(`/api/feeds/${id}`, { method: 'POST' })) as
      | { created?: number; status?: string; message?: string }
      | null;
    if (result) {
      setNotice(
        result.status === 'error'
          ? `${result.message}`
          : t('itemsImported', { count: result.created ?? 0 }),
      );
    }
    setPending(false);
  }

  const selectable = targets.filter((target) => target.canPublish);

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      )}
      {notice && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {notice}
        </div>
      )}

      {canManage && (
        <section className="card p-5">
          {!adding ? (
            <button type="button" className="btn-primary" onClick={() => setAdding(true)}>
              {t('add')}
            </button>
          ) : (
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="label" htmlFor="feedName">
                    {t('name')}
                  </label>
                  <input
                    id="feedName"
                    className="input"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                  />
                </div>
                <div>
                  <label className="label" htmlFor="feedUrl">
                    {t('url')}
                  </label>
                  <input
                    id="feedUrl"
                    className="input"
                    placeholder="https://example.com/feed.xml"
                    value={url}
                    onChange={(event) => setUrl(event.target.value)}
                  />
                </div>
              </div>

              <div>
                <label className="label" htmlFor="feedTemplate">
                  {t('template')}
                </label>
                <textarea
                  id="feedTemplate"
                  className="input min-h-[80px] font-mono text-xs"
                  value={template}
                  onChange={(event) => setTemplate(event.target.value)}
                />
                <p className="hint">{'{{title}} · {{link}} · {{description}}'}</p>
              </div>

              <div>
                <span className="label">{t('destinations')}</span>
                <div className="flex flex-wrap gap-2">
                  {selectable.map((target) => (
                    <label
                      key={target.id}
                      className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm"
                    >
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-slate-300 text-brand-500"
                        checked={selected.includes(target.id)}
                        onChange={() =>
                          setSelected((current) =>
                            current.includes(target.id)
                              ? current.filter((id) => id !== target.id)
                              : [...current, target.id],
                          )
                        }
                      />
                      {target.name}
                    </label>
                  ))}
                </div>
              </div>

              <label className="flex items-start gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-500"
                  checked={autoApprove}
                  onChange={(event) => setAutoApprove(event.target.checked)}
                />
                <span>
                  {t('autoApprove')}
                  <span className="block text-xs text-slate-500">{t('autoApproveHint')}</span>
                </span>
              </label>

              <div className="flex gap-2">
                <button
                  type="button"
                  className="btn-primary"
                  disabled={pending || !name.trim() || !url.trim() || selected.length === 0}
                  onClick={create}
                >
                  {pending ? tCommon('working') : t('add')}
                </button>
                <button type="button" className="btn-secondary" onClick={() => setAdding(false)}>
                  {tCommon('cancel')}
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      {feeds.length === 0 ? (
        <div className="card p-8 text-center text-sm text-slate-600">{t('none')}</div>
      ) : (
        feeds.map((feed) => (
          <section key={feed.id} className="card p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-900">{feed.name}</p>
                <ExternalLink
                  href={feed.url}
                  className="block truncate text-xs text-brand-600 hover:underline"
                >
                  {feed.url}
                </ExternalLink>
                <p className="mt-1 text-xs text-slate-500">
                  {feed.lastPolledLabel ? t('lastPolled', { when: feed.lastPolledLabel }) : t('neverPolled')}
                  {' · '}
                  {t('itemsImported', { count: feed.itemCount })}
                  {feed.pollErrorCount > 0 && ` · ${t('errorCount', { count: feed.pollErrorCount })}`}
                </p>
              </div>

              {canManage && (
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={pending}
                    onClick={() => pollNow(feed.id)}
                  >
                    {t('pollNow')}
                  </button>
                  <label className="flex items-center gap-2 text-xs text-slate-600">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-slate-300 text-brand-500"
                      checked={feed.enabled}
                      onChange={(event) =>
                        call(`/api/feeds/${feed.id}`, {
                          method: 'PATCH',
                          headers: { 'content-type': 'application/json' },
                          body: JSON.stringify({ enabled: event.target.checked }),
                        })
                      }
                    />
                    {t('enabled')}
                  </label>
                  <button
                    type="button"
                    className="btn-danger"
                    onClick={() => {
                      if (window.confirm(t('deleteConfirm'))) {
                        call(`/api/feeds/${feed.id}`, { method: 'DELETE' });
                      }
                    }}
                  >
                    {tCommon('delete')}
                  </button>
                </div>
              )}
            </div>

            {feed.lastError && (
              <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                {feed.lastError}
              </p>
            )}

            <p className="mt-3 whitespace-pre-wrap rounded-lg bg-slate-50 p-2 font-mono text-xs text-slate-600">
              {feed.messageTemplate}
            </p>
          </section>
        ))
      )}
    </div>
  );
}
