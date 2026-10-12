import Link from 'next/link';
import { getFormatter, getTranslations } from 'next-intl/server';

import { EmptyState } from '@/components/EmptyState';
import { FeedAvatar } from '@/components/FeedPost';
import { Icon } from '@/components/Icon';
import { InboxResolveButton } from '@/components/InboxResolveButton';
import { ChannelsLayout } from '@/components/ChannelsLayout';
import { requirePage } from '@/lib/auth';
import { countOpenInbox, readInbox, type InboxKind, type InboxState } from '@/lib/inbox';
import { screenMetadata } from '@/lib/metadata';
import { loadSelection } from '@/lib/page-filter';

export const dynamic = 'force-dynamic';

export function generateMetadata() {
  return screenMetadata('inbox.title');
}

const PAGE_SIZE = 50;
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/**
 * Everything people wrote to the selected Pages — comments and messages in
 * one stream, newest first — with a done state the whole team shares.
 * Replying happens where the thread lives (Analytics → Comments / Messages).
 */
export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const auth = await requirePage();
  const params = await searchParams;
  const selection = await loadSelection(auth, params);
  const t = await getTranslations('inbox');
  const format = await getFormatter();

  const typeParam = first(params.type);
  const kind: InboxKind | undefined = typeParam === 'comment' || typeParam === 'message' ? typeParam : undefined;
  const stateParam = first(params.state);
  const state: InboxState = stateParam === 'resolved' || stateParam === 'all' ? stateParam : 'open';
  const limit = Math.min(Math.max(Number(first(params.limit)) || PAGE_SIZE, PAGE_SIZE), 500);

  const scope = { workspaceId: auth.workspace.id, targetIds: selection.ids };
  const [items, open] = await Promise.all([readInbox({ ...scope, kind, state, limit }), countOpenInbox(scope)]);

  const href = (next: { type?: string; state?: string; limit?: number }) => {
    const query = new URLSearchParams(selection.query);
    const type = 'type' in next ? next.type : kind;
    const nextState = 'state' in next ? next.state : state;
    if (type) query.set('type', type);
    if (nextState && nextState !== 'open') query.set('state', nextState);
    if (next.limit) query.set('limit', String(next.limit));
    const text = query.toString();
    return text ? `/inbox?${text}` : '/inbox';
  };

  const segmented = (label: string, options: Array<{ key: string | undefined; label: string; href: string }>, active: string | undefined) => (
    <nav className="segmented" aria-label={label}>
      {options.map((option) => (
        <Link
          key={option.key ?? 'all'}
          href={option.href}
          aria-current={option.key === active ? 'page' : undefined}
          className={`segmented-item ${option.key === active ? 'segmented-item-active' : ''}`}
        >
          {option.label}
        </Link>
      ))}
    </nav>
  );

  return (
    <ChannelsLayout auth={auth} selection={selection}>
    <div className="min-w-0 flex-1 space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold sm:text-2xl text-slate-900">{t('title')}</h1>
          <p className="mt-1 text-sm text-slate-600">
            {t('subtitle', { comments: open.comments, messages: open.messages, profiles: selection.ids.length })}
          </p>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-3">
        {segmented(
          t('typeLabel'),
          [
            { key: undefined, label: t('typeAll'), href: href({ type: undefined }) },
            { key: 'comment', label: t('typeComments'), href: href({ type: 'comment' }) },
            { key: 'message', label: t('typeMessages'), href: href({ type: 'message' }) },
          ],
          kind,
        )}
        {segmented(
          t('stateLabel'),
          [
            { key: 'open', label: t('stateOpen'), href: href({ state: 'open' }) },
            { key: 'resolved', label: t('stateResolved'), href: href({ state: 'resolved' }) },
            { key: 'all', label: t('stateAll'), href: href({ state: 'all' }) },
          ],
          state,
        )}
      </div>

      {items.length === 0 ? (
        <EmptyState
          icon="inbox"
          title={state === 'open' ? t('emptyOpenTitle') : t('emptyTitle')}
          hint={state === 'open' ? t('emptyOpenHint') : t('emptyHint')}
        />
      ) : (
        <ul className="space-y-3" aria-label={t('listLabel')}>
          {items.map((item) => (
            <li key={`${item.kind}:${item.id}`} className="card flex flex-col gap-3 p-4 sm:flex-row sm:items-start">
              <FeedAvatar name={item.targetName} pictureUrl={item.targetPictureUrl} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
                  <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-700">
                    <Icon name={item.kind === 'comment' ? 'comment' : 'inbox'} size={12} />{' '}
                    {item.kind === 'comment' ? (item.isReply ? t('kindReply') : t('kindComment')) : t('kindMessage')}
                  </span>
                  <span className="font-medium text-slate-700">{item.targetName}</span>
                  <time dateTime={item.at.toISOString()}>{format.relativeTime(item.at)}</time>
                  {item.resolvedAt && <span className="rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700">{t('done')}</span>}
                </p>
                <p className="mt-1 text-sm font-semibold text-slate-900">{item.author || t('someone')}</p>
                <p className="mt-0.5 whitespace-pre-line break-words text-sm text-slate-800">{item.text || t('noText')}</p>
                {item.postMessage && (
                  <p className="mt-2 line-clamp-2 border-s-2 border-slate-200 ps-2 text-xs text-slate-500">
                    {t('onPost', { post: item.postMessage })}
                  </p>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2 sm:flex-col sm:items-end">
                <Link
                  className="btn-secondary"
                  href={`/analytics?view=${item.kind === 'comment' ? 'comments' : 'inbox'}&target=${item.targetId}`}
                >
                  {t('reply')}
                </Link>
                <InboxResolveButton kind={item.kind} id={item.id} resolved={item.resolvedAt !== null} />
              </div>
            </li>
          ))}
        </ul>
      )}

      {items.length === limit && limit < 500 && (
        <div className="flex justify-center">
          <Link className="btn-secondary" href={href({ limit: limit + PAGE_SIZE })}>
            {t('showMore')}
          </Link>
        </div>
      )}
    </div>
    </ChannelsLayout>
  );
}
