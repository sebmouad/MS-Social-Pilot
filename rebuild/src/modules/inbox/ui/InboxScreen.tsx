import { ChannelBadge } from '@/components';
import { OperationError, operationFailure } from '@/lib/operation-error';
import { channelBadgeInfo } from '@/lib/channel-badge';
import { inboxHref, inboxListInput, type InboxLocation, type InboxSearchParams } from '@/modules/inbox/query';
import type { ReactNode } from 'react';
import type { InboxFilters, InboxListPage, InboxThreadPage, OpenThread, ThreadEntry } from '@/modules/inbox/server/types';
import { readInboxList, readInboxThread } from '@/modules/inbox/server/read';
import { PageFrame } from '@/server/PageFrame';
import { requireViewer } from '@/server/context';
import { canManageInbox, canManageInboxWorkflow } from '@/modules/inbox/server/actions';
import { inboxReplyPolicy } from '@/modules/inbox/server/policy';
import { inboxCapabilities } from '@/modules/inbox/server/providers';
import { formatInboxTime } from '@/modules/inbox/server/threads';
import { InboxSyncBar, ReplyBox, ThreadToolbar } from './InboxActions';
import { reviewSummary, reviewText } from '@/modules/inbox/reviews-copy';
import { ThreadTools } from './ThreadTools';
import { NestedReply } from './NestedReply';
import { InboxTag } from './InboxTags';
import styles from './inbox.module.css';

// The Inbox page has no per-user language yet; moderation defaults the same way.
const LOCALE = 'en' as const;
const DEFAULT_FILTERS: InboxFilters = { channelId: null, kind: 'all', state: 'open', hidden: 'visible', q: '' };
const singleValue = (value: string | string[] | undefined) => typeof value === 'string' ? value : undefined;

function cursorError(field: string) {
  return new OperationError('invalid_request', `Choose one ${field} value, or reset to the latest Inbox items.`);
}

function locationFrom(page: InboxListPage | null, params: InboxSearchParams): InboxLocation {
  const filters = page?.filters ?? DEFAULT_FILTERS;
  const channel = filters.channelId ?? 'all';
  return {
    ...(channel !== 'all' ? { channel } : {}),
    ...(filters.kind !== 'all' ? { type: filters.kind } : {}),
    ...(filters.state !== 'open' ? { status: filters.state } : {}),
    ...(filters.hidden !== 'visible' ? { hidden: filters.hidden } : {}),
    ...(filters.q ? { q: filters.q } : {}),
    ...(page ? { limit: String(page.limit) } : typeof params.limit === 'string' ? { limit: params.limit } : {}),
  };
}

function pageRangeLabel(shown: number, total: number) {
  if (total === 0) return '0 stored items';
  return `${shown} ${shown === 1 ? 'item' : 'items'} shown · ${total} stored matches`;
}

export default async function InboxPage({ searchParams }: { searchParams: Promise<InboxSearchParams> }) {
  const viewer = await requireViewer({ feature: 'inbox/conversations', channelScoped: true });
  const params = await searchParams;
  const actor = { userId: viewer.user.id, workspaceId: viewer.workspaceId };
  const constraints = viewer.permissions.pageScope.all ? undefined : { allowedChannelIds: viewer.permissions.pageScope.ids };

  const listOutcome = await (async () => {
    try { return { page: await readInboxList(actor, inboxListInput(params), constraints), error: null }; }
    catch (error) { return { page: null, error: operationFailure(error, 'The Inbox could not be loaded. Try again or reset the filters.') }; }
  })();
  const listPage = listOutcome.page;
  const baseLocation = locationFrom(listPage, params);
  const requestedThread = singleValue(params.thread);
  const requestedHistoryCursor = singleValue(params.historyCursor);
  let threadOutcome: { page: InboxThreadPage | null; error: { error: string; code: string; status: number } | null } = { page: null, error: null };
  if (params.thread !== undefined && !requestedThread) {
    threadOutcome = { page: null, error: operationFailure(cursorError('conversation'), 'The selected conversation could not be opened.') };
  } else if (params.historyCursor !== undefined && !requestedThread) {
    threadOutcome = { page: null, error: operationFailure(cursorError('history cursor'), 'Choose a conversation before opening its history.') };
  } else if (params.historyCursor !== undefined && !requestedHistoryCursor) {
    threadOutcome = { page: null, error: operationFailure(cursorError('history cursor'), 'The conversation history could not be loaded.') };
  } else if (requestedThread) {
    try {
      threadOutcome = { page: await readInboxThread(actor, { key: requestedThread, ...(requestedHistoryCursor ? { cursor: requestedHistoryCursor } : {}) }, constraints), error: null };
    } catch (error) {
      threadOutcome = { page: null, error: operationFailure(error, 'This conversation could not be opened. Return to the Inbox list and try again.') };
    }
  }

  const threadPage = threadOutcome.page;
  const thread: OpenThread | null = threadPage?.thread ?? null;
  const timeZone = listPage?.timeZone ?? viewer.membership.workspace.timezone;
  const filters = listPage?.filters ?? DEFAULT_FILTERS;
  const channel = filters.channelId ?? 'all';
  const clearThreadHref = inboxHref({ ...baseLocation, ...(listPage?.cursor ? { cursor: listPage.cursor } : {}) });
  const resetHref = inboxHref(threadOutcome.page && requestedThread ? { thread: requestedThread } : {});
  const listPagingLocation = {
    ...baseLocation,
    ...(threadPage && requestedThread ? { thread: requestedThread } : {}),
    ...(threadPage && requestedHistoryCursor ? { historyCursor: requestedHistoryCursor } : {}),
  };

  let threadView = null;
  if (thread) {
    const [canWrite, canResolve, capabilities, rule] = await Promise.all([
      canManageInbox(actor, thread.target.id),
      canManageInboxWorkflow(actor, thread.target.id),
      thread.target.provider ? inboxCapabilities(thread.target.provider) : Promise.resolve({ reply: false, hide: false, remove: false, reviews: false, replyToReviews: false }),
      thread.kind === 'review' ? Promise.resolve({ allowed: false, headline: '', detail: undefined }) : inboxReplyPolicy(thread.target.provider, { kind: thread.kind, channelRemoteId: thread.target.providerId, lastInbound: thread.lastInbound, timeZone }),
    ]);
    const badge = channelBadgeInfo(thread.target.provider);
    const first = thread.entries.find(entry => !entry.fromChannel);
    const history = threadPage!.history;
    const childrenOf = new Map<string, ThreadEntry[]>();
    for (const entry of thread.entries) if (entry.parentId) childrenOf.set(entry.parentId, [...(childrenOf.get(entry.parentId) ?? []), entry]);
    // Replies are actionable through the same shared services as the opening comment; the channel module's declared capabilities decide which actions exist.
    const renderEntry = (entry: ThreadEntry): ReactNode => {
      const replies = childrenOf.get(entry.id) ?? [];
      const isReply = entry.parentId !== null;
      return <li key={entry.id} className={styles.entryNode}>
        <div className={styles.entry} data-from={entry.fromChannel ? 'channel' : 'person'} data-reply={isReply || undefined}>
          <div className={styles.entryHead}><strong>{entry.author}</strong>{entry.sentBy ? <span>sent by {entry.sentBy}</span> : null}{entry.hidden ? <InboxTag icon="hidden">Hidden</InboxTag> : null}<time dateTime={entry.time.toISOString()}>{formatInboxTime(entry.time, timeZone, true)}</time></div>
          <p>{entry.text || 'No text in this message.'}</p>
          {isReply && canWrite && (capabilities.hide || capabilities.remove) ? <ThreadToolbar reply id={entry.id} kind="comment" resolved={false} hidden={entry.hidden} canResolve={canWrite} canHide={capabilities.hide} canDelete={capabilities.remove} platformName={badge.platformName} listHref={clearThreadHref} /> : null}
          {isReply && !entry.fromChannel ? <NestedReply id={entry.id} author={entry.author} canReply={canWrite && capabilities.reply} allowed={rule.allowed} /> : null}
        </div>
        {replies.length ? <ol className={styles.replies} aria-label={`Replies to ${entry.author}`}>{replies.map(reply => renderEntry(reply))}</ol> : null}
      </li>;
    };
    const historyName = thread.kind === 'comment' ? 'replies' : 'messages';
    const openingItemPresent = Boolean(listPage?.items.some(item => item.key === `${thread.kind}:${thread.id}`));
    threadView = <section className={styles.threadPane} aria-label={thread.kind === 'message' ? 'Open conversation' : thread.kind === 'review' ? reviewText(LOCALE, 'openReview') : 'Open comment'}>
      <a className={styles.back} href={clearThreadHref}>← All conversations</a>
      {!openingItemPresent && listPage ? <p className={styles.contextNote}>This conversation is outside the current list page. It stays open while you browse.</p> : null}
      <header className={styles.threadHead}>
        <h2>{thread.kind === 'message' ? `Conversation with ${first?.author ?? 'a visitor'}` : thread.kind === 'review' ? reviewText(LOCALE, 'reviewBy', { name: thread.entries[0]?.author ?? 'a visitor' }) : `Comment by ${thread.entries[0]?.author ?? 'a visitor'}`}</h2>
        <div className={styles.threadTags}>
          <ChannelBadge name={thread.target.name} platformName={badge.platformName} mark={badge.mark} />
          <InboxTag icon={thread.kind === 'message' ? 'message' : 'comment'}>{thread.kind === 'message' ? 'Message' : thread.kind === 'review' ? reviewText(LOCALE, 'review') : 'Comment'}</InboxTag>
          {thread.kind === 'review' ? <InboxTag icon="comment">{reviewSummary(LOCALE, thread)}</InboxTag> : null}
          {thread.resolved ? <InboxTag icon="resolved" tone="ok">Resolved</InboxTag> : <InboxTag icon="needsReply" tone="warn">Open</InboxTag>}
          {thread.hidden ? <InboxTag icon="hidden">Hidden</InboxTag> : null}
        </div>
      </header>
      {thread.postText ? <p className={styles.postContext}><strong>On your post</strong>{thread.postText.length > 280 ? `${thread.postText.slice(0, 280)}…` : thread.postText}</p> : null}
      <p className={styles.contextNote}>{thread.kind === 'review' ? reviewText(LOCALE, 'note') : 'This is activity already synced to the app. Earlier messages or replies on the platform may not have been fetched yet.'}</p>
      <div className={styles.historyHead}>
        <h3>{thread.kind === 'comment' ? 'Comment history' : thread.kind === 'review' ? reviewText(LOCALE, 'reviewHistory') : 'Conversation history'}</h3>
        <span>{history.shown} of {history.total} stored {historyName} shown</span>
      </div>
      {history.cursor && history.shown === 0 ? <p className={styles.contextNote}>No stored history at this position. Choose Latest in the sidebar to return to recent messages or replies.</p> : null}
      <ol className={styles.entries} aria-label="History">
        {(thread.kind === 'comment' ? thread.entries.filter(entry => entry.parentId === null) : thread.entries).map(entry => renderEntry(entry))}
      </ol>
      {canResolve ? <ThreadToolbar id={thread.id} kind={thread.kind} resolved={thread.resolved} hidden={thread.hidden} canResolve={canResolve} canHide={canWrite && capabilities.hide} canDelete={canWrite && capabilities.remove} platformName={badge.platformName} listHref={clearThreadHref} /> : null}
      {thread.kind === 'review'
        ? (canWrite && capabilities.replyToReviews ? <ReplyBox key={thread.id} id={thread.id} kind="review" allowed headline="" /> : <p>{reviewText(LOCALE, 'replyUnavailable')}</p>)
        : <ThreadTools kind={thread.kind} id={thread.id} canWrite={canWrite} canReply={capabilities.reply} allowed={rule.allowed} headline={rule.headline} detail={rule.detail} />}
    </section>;
  }

  const visibleChannels = listPage?.channels ?? [];
  const selectedChannel = channel === 'all' ? 'all' : channel;
  const filtered = Boolean(filters.channelId || filters.kind !== 'all' || filters.state !== 'open' || filters.hidden !== 'visible' || filters.q);
  const syncTarget = selectedChannel === 'all' ? undefined : selectedChannel;

  const sidebar = <aside className={styles.filters} aria-label="Inbox filters and navigation">
    <p className={styles.filterHeading}>Filters</p>
    <form method="get" action={inboxHref()} noValidate>
      {requestedThread ? <input type="hidden" name="thread" value={requestedThread} /> : null}
      <label>Search messages and people<input className={styles.searchInput} type="search" name="q" maxLength={listPage?.limits.searchMaxCharacters} defaultValue={filters.q} placeholder="Name or message text" /></label>
      <label>Channel<select name="channel" defaultValue={selectedChannel}><option value="all">All channels</option>{visibleChannels.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label>Type<select name="type" defaultValue={filters.kind}><option value="all">All types</option><option value="message">Messages</option><option value="comment">Comments</option><option value="review">{reviewText(LOCALE, 'reviews')}</option></select></label>
      <label>Status<select name="status" defaultValue={filters.state}><option value="open">Open</option><option value="resolved">Resolved</option><option value="all">All</option></select></label>
      <label>Hidden comments<select name="hidden" defaultValue={filters.hidden}><option value="visible">Hide them</option><option value="all">Show them</option></select></label>
      <label>Items per page<input type="number" name="limit" min={1} max={listPage?.limits.listPageSize} defaultValue={listPage?.limit} disabled={!listPage} /></label>
      <button className="ui-button ui-button--primary ui-button--md" type="submit">Apply filters</button>
      <a href="/inbox">Reset filters</a>
    </form>
    <div className={styles.navigationGroup}>
      <p className={styles.filterHeading}>Automation</p>
      <a href="/inbox/moderation">Moderation rules</a>
    </div>
    {listPage ? <div className={styles.navigationGroup}>
      <p className={styles.filterHeading}>Conversations</p>
      <nav className={styles.pagination} aria-label="Inbox list pages">
        {listPage.olderCursor ? <a href={inboxHref({ ...listPagingLocation, cursor: listPage.olderCursor })}>Older</a> : <span aria-disabled="true">Older</span>}
        {listPage.cursor ? <a href={inboxHref({ ...listPagingLocation, cursor: undefined })}>Latest</a> : <span aria-disabled="true">Latest</span>}
        {listPage.newerCursor ? <a href={inboxHref({ ...listPagingLocation, cursor: listPage.newerCursor })}>Newer</a> : <span aria-disabled="true">Newer</span>}
      </nav>
    </div> : null}
    {threadPage ? <div className={styles.navigationGroup}>
      <p className={styles.filterHeading}>{thread?.kind === 'comment' ? 'Reply history' : 'Message history'}</p>
      <nav className={styles.pagination} aria-label="Conversation history pages">
        {threadPage.history.olderCursor ? <a href={inboxHref({ ...baseLocation, ...(listPage?.cursor ? { cursor: listPage.cursor } : {}), thread: `${thread!.kind}:${thread!.id}`, historyCursor: threadPage.history.olderCursor })}>Earlier</a> : <span aria-disabled="true">Earlier</span>}
        {threadPage.history.cursor ? <a href={inboxHref({ ...baseLocation, ...(listPage?.cursor ? { cursor: listPage.cursor } : {}), thread: `${thread!.kind}:${thread!.id}` })}>Latest</a> : <span aria-disabled="true">Latest</span>}
        {threadPage.history.newerCursor ? <a href={inboxHref({ ...baseLocation, ...(listPage?.cursor ? { cursor: listPage.cursor } : {}), thread: `${thread!.kind}:${thread!.id}`, historyCursor: threadPage.history.newerCursor })}>Newer</a> : <span aria-disabled="true">Newer</span>}
      </nav>
    </div> : null}
  </aside>;

  const listError = listOutcome.error;
  const lastSynced = listPage?.lastSynced ?? null;
  const noChannels = listPage !== null && visibleChannels.length === 0;

  return <PageFrame module="inbox" scopedAccess sidebar={sidebar}><div className={styles.page}>
    <header className={styles.head}>
      <div><p className="eyebrow">Inbox</p><h1>Conversations</h1><p>Messages, comments and reviews from the channels you can access.</p></div>
      {visibleChannels.length > 0 && <InboxSyncBar targetId={syncTarget} lastSynced={lastSynced ? formatInboxTime(lastSynced, timeZone, true) : null} timeZone={timeZone} />}
    </header>
    {listError ? <div role="alert" className={styles.alert}><p>{listError.error}</p><a href={resetHref}>Reset filters and return to the latest Inbox items</a></div> : null}
    {threadOutcome.error ? <div role="alert" className={styles.alert}><p>{threadOutcome.error.error}</p><a href={clearThreadHref}>Return to the Inbox list</a></div> : null}
    {noChannels ? <section className="panel"><div className={styles.empty}>
      <h2>No channels with an inbox yet</h2>
      <p>Messages sent to your channels and comments on your published posts show up here once a channel that supports them is connected and selected.</p>
      <a className="text-link" href="/settings/connections">Go to Connections</a>
    </div></section> : listPage ? <div className={styles.split} data-open={thread ? 'true' : 'false'}>
      <section className={styles.listPane} aria-label="Conversations and comments">
        <div className={styles.listHead}><h2>{filters.state === 'resolved' ? 'Resolved' : filters.state === 'all' ? 'All activity' : 'Open'}</h2><span>{pageRangeLabel(listPage.items.length, listPage.total)}</span></div>
        {listPage.items.length ? <ul className={styles.list}>{listPage.items.map(item => {
          const badge = channelBadgeInfo(item.target.provider);
          const selected = thread !== null && thread.kind === item.kind && thread.id === item.id;
          return <li key={item.key}><a className={styles.item} href={inboxHref({ ...baseLocation, ...(listPage.cursor ? { cursor: listPage.cursor } : {}), thread: item.key })} aria-current={selected ? 'true' : undefined} data-attention={item.needsReply || item.unread > 0 || undefined}>
            <div className={styles.itemTop}><span className={styles.author}>{item.author}</span><time dateTime={item.time.toISOString()}>{formatInboxTime(item.time, timeZone)}</time></div>
            <p className={styles.preview}>{item.kind === 'review' && !item.preview ? reviewText(LOCALE, 'noText') : item.preview.length > 180 ? `${item.preview.slice(0, 180)}…` : item.preview}</p>
            <div className={styles.itemMeta}>
              <ChannelBadge name={item.target.name} platformName={badge.platformName} mark={badge.mark} compact />
              <InboxTag icon={item.kind === 'message' ? 'message' : 'comment'}>{item.kind === 'message' ? 'Message' : item.kind === 'review' ? reviewText(LOCALE, 'review') : 'Comment'}</InboxTag>
              {item.kind === 'review' ? <InboxTag icon="comment">{reviewSummary(LOCALE, item)}</InboxTag> : null}
              {item.unread > 0 ? <InboxTag icon="unread" tone="warn">{item.unread} unread</InboxTag> : null}
              {item.needsReply ? <InboxTag icon="needsReply" tone="warn">Needs reply</InboxTag> : null}
              {item.resolved ? <InboxTag icon="resolved" tone="ok">Resolved</InboxTag> : null}
              {item.hidden ? <InboxTag icon="hidden">Hidden</InboxTag> : null}
            </div>
          </a></li>;
        })}</ul> : <div className={styles.empty}>
          {listPage.total > 0 && listPage.cursor ? <><h2>No items on this page</h2><p>The Inbox changed while you were browsing. Return to the latest items or choose another page.</p><a className="text-link" href={inboxHref({ ...listPagingLocation, cursor: undefined })}>Show the latest items</a></>
            : filtered ? <><h2>Nothing matches these filters</h2><p>Try another channel, type, status or search.</p><a className="text-link" href="/inbox">Reset filters</a></>
            : lastSynced ? <><h2>No open conversations</h2><p>New messages and comments appear here after a sync. Resolved conversations are under Status.</p><a className="text-link" href="/inbox?status=resolved">Show resolved</a></>
            : <><h2>Your inbox is empty</h2><p>Messages people send to your channels and comments on your published posts appear here after the first sync. Use Sync now to check for them.</p></>}
        </div>}
      </section>
      {threadView ?? <section className={`${styles.threadPane} ${styles.empty} ${styles.pick}`} aria-label="Open conversation"><h2>Select a conversation</h2><p>Choose a message or comment on the left to read its history and reply.</p></section>}
    </div> : null}
  </div></PageFrame>;
}
