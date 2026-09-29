'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';

import type { TargetOption } from './TargetPicker';
import { ExternalLink } from './ExternalLink';
import { StatusBadge } from './StatusBadge';
import { renderTemplate } from '@/lib/rss/parse';

export interface FeedItemView {
  id: string;
  title: string | null;
  url: string | null;
  importedLabel: string;
  /** Null when the entry had nothing to post, or its post has been deleted. */
  post: { status: string; href: string } | null;
}

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
  recentItems: FeedItemView[];
}

interface Props {
  feeds: FeedView[];
  targets: TargetOption[];
  canManage: boolean;
}

const DEFAULT_TEMPLATE = '{{title}}\n\n{{link}}';

interface FeedFields {
  name: string;
  url: string;
  messageTemplate: string;
  targetIds: string[];
  autoApprove: boolean;
}

export function FeedsClient({ feeds, targets, canManage }: Props) {
  const t = useTranslations('feeds');
  const tCommon = useTranslations('common');
  const router = useRouter();

  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  /**
   * Every request goes through here, so none can leave the screen stuck: a
   * network failure is reported like a refusal, and the buttons come back
   * either way.
   */
  async function call(path: string, init: RequestInit): Promise<unknown | null> {
    setError(null);
    setNotice(null);
    setPending(true);
    try {
      const response = await fetch(path, init);
      const body = (await response.json().catch(() => ({}))) as Record<string, unknown> & {
        error?: string;
        fields?: Record<string, string>;
      };
      if (!response.ok) {
        setError((body.fields && Object.values(body.fields)[0]) || body.error || tCommon('genericError'));
        return null;
      }
      router.refresh();
      return body;
    } catch {
      setError(tCommon('genericError'));
      return null;
    } finally {
      setPending(false);
    }
  }

  async function create(fields: FeedFields) {
    const result = await call('/api/feeds', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(fields),
    });
    if (result) setAdding(false);
  }

  async function save(feed: FeedView, fields: FeedFields) {
    // Destinations that exist but cannot be picked right now (disabled, or a
    // token short of permission) are not in the form. Kept, so renaming a
    // feed does not silently drop a Page that is only briefly unavailable;
    // the poller skips it until it is back.
    const unavailable = feed.targetIds.filter(
      (targetId) =>
        targets.some((target) => target.id === targetId) &&
        !selectable.some((target) => target.id === targetId),
    );
    const id = feed.id;
    // The address is not editable: a different URL is a different feed, with
    // its own history of what has already been posted.
    const result = await call(`/api/feeds/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: fields.name,
        messageTemplate: fields.messageTemplate,
        targetIds: [...fields.targetIds, ...unavailable],
        autoApprove: fields.autoApprove,
      }),
    });
    if (result) {
      setEditing(null);
      setNotice(t('saved'));
    }
  }

  async function pollNow(id: string) {
    const result = (await call(`/api/feeds/${id}`, { method: 'POST' })) as
      | { created?: number; status?: string }
      | null;
    if (!result) return;
    // The reason is recorded on the feed and shown on its card once the page
    // refreshes; this only has to say that the check did not work.
    if (result.status === 'error' || result.status === 'skipped') setError(t('pollFailed'));
    else setNotice(t('itemsImported', { count: result.created ?? 0 }));
  }

  // Feeds post a link and some text, which Instagram cannot publish; the
  // server refuses it as a destination, so it is not offered.
  const selectable = targets.filter((target) => target.canPublish && target.type !== 'instagram');

  return (
    <div className="space-y-4">
      {error && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}
      {notice && (
        <div
          role="status"
          className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700"
        >
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
            <FeedForm
              mode="add"
              initial={{ name: '', url: '', messageTemplate: DEFAULT_TEMPLATE, targetIds: [], autoApprove: true }}
              targets={selectable}
              pending={pending}
              sample={null}
              onSubmit={create}
              onCancel={() => setAdding(false)}
            />
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
                  {' · '}
                  {feed.autoApprove ? t('autoApproveOn') : t('autoApproveOff')}
                </p>
              </div>

              {canManage && editing !== feed.id && (
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={pending}
                    onClick={() => pollNow(feed.id)}
                  >
                    {t('pollNow')}
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={pending}
                    onClick={() => {
                      setError(null);
                      setNotice(null);
                      setEditing(feed.id);
                    }}
                  >
                    {tCommon('edit')}
                  </button>
                  <label className="flex items-center gap-2 text-xs text-slate-600">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-slate-300 text-brand-500"
                      checked={feed.enabled}
                      disabled={pending}
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
                    disabled={pending}
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

            {editing === feed.id ? (
              <div className="mt-4 border-t border-slate-100 pt-4">
                <FeedForm
                  mode="edit"
                  initial={{
                    name: feed.name,
                    url: feed.url,
                    messageTemplate: feed.messageTemplate,
                    // Only what can be ticked; `save` puts back the rest.
                    targetIds: feed.targetIds.filter((id) => selectable.some((target) => target.id === id)),
                    autoApprove: feed.autoApprove,
                  }}
                  targets={selectable}
                  pending={pending}
                  sample={feed.recentItems[0] ?? null}
                  onSubmit={(fields) => save(feed, fields)}
                  onCancel={() => setEditing(null)}
                />
              </div>
            ) : (
              <p className="mt-3 whitespace-pre-wrap [overflow-wrap:anywhere] rounded-lg bg-slate-50 p-2 font-mono text-xs text-slate-600">
                {feed.messageTemplate}
              </p>
            )}

            {feed.recentItems.length > 0 && (
              <div className="mt-4">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t('recent')}</h3>
                <ul className="mt-2 divide-y divide-slate-100">
                  {feed.recentItems.map((item) => (
                    <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                      <div className="min-w-0 flex-1">
                        {item.url ? (
                          <ExternalLink
                            href={item.url}
                            className="block truncate text-slate-800 hover:text-brand-600 hover:underline"
                          >
                            {item.title || item.url}
                          </ExternalLink>
                        ) : (
                          <span className="block truncate text-slate-800">{item.title || t('untitled')}</span>
                        )}
                        <span className="text-xs text-slate-500">{t('importedAt', { when: item.importedLabel })}</span>
                      </div>
                      {item.post ? (
                        <Link href={item.post.href} className="flex items-center gap-2 text-xs hover:underline">
                          <StatusBadge status={item.post.status} />
                          <span className="text-brand-600">{t('viewPost')}</span>
                        </Link>
                      ) : (
                        <span className="text-xs text-slate-500">{t('noPost')}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        ))
      )}
    </div>
  );
}

/** The fields shared by adding a feed and editing one. */
function FeedForm({
  mode,
  initial,
  targets,
  pending,
  sample,
  onSubmit,
  onCancel,
}: {
  mode: 'add' | 'edit';
  initial: FeedFields;
  targets: TargetOption[];
  pending: boolean;
  /** A real item to preview the template with, when the feed has one. */
  sample: Pick<FeedItemView, 'title' | 'url'> | null;
  onSubmit: (fields: FeedFields) => void;
  onCancel: () => void;
}) {
  const t = useTranslations('feeds');
  const tCommon = useTranslations('common');
  const id = useId();

  const [name, setName] = useState(initial.name);
  const [url, setUrl] = useState(initial.url);
  const [template, setTemplate] = useState(initial.messageTemplate);
  const [selected, setSelected] = useState<string[]>(initial.targetIds);
  const [autoApprove, setAutoApprove] = useState(initial.autoApprove);

  // The feed's own latest item where there is one: a preview of the actual
  // headline is a better check than a made-up one.
  const preview = renderTemplate(template, {
    guid: 'preview',
    title: sample?.title ?? t('sampleTitle'),
    link: sample?.url ?? 'https://example.com/article',
    description: t('sampleDescription'),
    publishedAt: null,
  });

  const ready = name.trim() && template.trim() && selected.length > 0 && (mode === 'edit' || url.trim());

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (ready) onSubmit({ name, url, messageTemplate: template, targetIds: selected, autoApprove });
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor={`${id}-name`}>
            {t('name')}
          </label>
          <input
            id={`${id}-name`}
            className="input"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        {mode === 'add' && (
          <div>
            <label className="label" htmlFor={`${id}-url`}>
              {t('url')}
            </label>
            <input
              id={`${id}-url`}
              className="input"
              type="url"
              placeholder="https://example.com/feed.xml"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
            />
          </div>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor={`${id}-template`}>
            {t('template')}
          </label>
          <textarea
            id={`${id}-template`}
            className="input min-h-[96px] font-mono text-xs"
            value={template}
            onChange={(event) => setTemplate(event.target.value)}
          />
          <p className="hint">{t('templateHint')}</p>
        </div>
        <div>
          <span className="label">{t('preview')}</span>
          <p
            data-testid="feed-template-preview"
            className="min-h-[96px] whitespace-pre-wrap [overflow-wrap:anywhere] rounded-lg border border-slate-200 bg-slate-50 p-2 text-sm text-slate-700"
          >
            {preview || <span className="text-slate-400">{t('previewEmpty')}</span>}
          </p>
        </div>
      </div>

      <fieldset>
        <legend className="label">{t('destinations')}</legend>
        {targets.length === 0 ? (
          <p className="hint">{t('noDestinations')}</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {targets.map((target) => (
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
                        ? current.filter((targetId) => targetId !== target.id)
                        : [...current, target.id],
                    )
                  }
                />
                {target.name}
              </label>
            ))}
          </div>
        )}
      </fieldset>

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
        <button type="submit" className="btn-primary" disabled={pending || !ready}>
          {pending ? tCommon('working') : mode === 'add' ? t('add') : tCommon('save')}
        </button>
        <button type="button" className="btn-secondary" onClick={onCancel}>
          {tCommon('cancel')}
        </button>
      </div>
    </form>
  );
}
