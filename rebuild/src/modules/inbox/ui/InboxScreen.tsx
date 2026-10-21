import { loadInboxCustomerCopy } from '@/modules/inbox/server/customer-copy';
import { resolveInboxCatalog } from '@/modules/inbox/customer-copy';
import { InboxCopyProvider } from '@/modules/inbox/ui/copy-context';
import { IconInbox, IconInboxOff, IconMessages, IconPlugConnected } from '@tabler/icons-react';
import { ChannelBadge, EmptyState } from '@/components';
import { OperationError, operationFailure } from '@/lib/operation-error';
import { channelBadgeInfo } from '@/lib/channel-badge';
import { inboxHref, inboxListInput, type InboxLocation, type InboxSearchParams } from '@/modules/inbox/query';
import type { ReactNode } from 'react';
import type { InboxFilters, InboxListPage, InboxSentiment, InboxThreadPage, OpenThread, ThreadEntry } from '@/modules/inbox/server/types';
import { readInboxList, readInboxThread } from '@/modules/inbox/server/read';
import { PageFrame } from '@/server/PageFrame';
import { requireViewer } from '@/server/context';
import { canManageInbox, canManageInboxWorkflow } from '@/modules/inbox/server/actions';
import { inboxReplyPolicy } from '@/modules/inbox/server/policy';
import { inboxCapabilities } from '@/modules/inbox/server/providers';
import { formatInboxTime } from '@/modules/inbox/server/threads';
import { UrlFilterChips, type UrlFilterChip } from '@/modules/publishing/ui/kit/UrlFilterChips';
import { InboxSyncBar, ReplyBox, ThreadToolbar } from './InboxActions';
import { reviewSummary, reviewText } from '@/modules/inbox/reviews-copy';
import { ThreadTools } from './ThreadTools';
import { NestedReply } from './NestedReply';
import { InboxTag } from './InboxTags';
import { InboxHeader, PersonAvatar, ShortcutHint } from './InboxChrome';
import { InboxFilterPanel } from './InboxFilterPanel';
import { InboxShortcuts } from './InboxShortcuts';
import { BulkBar } from './BulkBar';
import { ContactDetails } from './ContactDetails';
import { ThreadScroll } from './ThreadScroll';
import { InboxSelectionProvider, SelectBox, type SelectableItem } from './InboxSelection';
import { SavedRepliesManager } from './SavedRepliesManager';
import { readInboxContactDetails } from '@/modules/inbox/server/details';
import type { InboxContactDetails } from '@/modules/inbox/details';
import { inboxLocale } from './locale';
import styles from './inbox.module.css';
import r3 from './inbox-round3.module.css';

const DEFAULT_FILTERS: InboxFilters = { channelId: null, kind: 'all', state: 'open', hidden: 'visible', q: '' };
const singleValue = (value: string | string[] | undefined) => typeof value === 'string' ? value : undefined;
const SENTIMENT_TONE = { positive: 'ok', neutral: 'neutral', negative: 'danger' } as const satisfies Record<InboxSentiment, 'ok' | 'neutral' | 'danger'>;

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
    ...(page?.quick?.length ? { quick: page.quick.join(',') } : {}),
    ...(page ? { limit: String(page.limit) } : typeof params.limit === 'string' ? { limit: params.limit } : {}),
  };
}

export default async function InboxPage({ searchParams }: { searchParams: Promise<InboxSearchParams> }) {
  const viewer = await requireViewer({ feature: 'inbox/conversations', channelScoped: true });
  const params = await searchParams;
  const locale = await inboxLocale();
  const catalog = await loadInboxCustomerCopy();
  const copy = resolveInboxCatalog('inboxCopy', catalog)[locale];
  const reviews = resolveInboxCatalog('reviewCopy', catalog);
  const reviewLabel = (language: Parameters<typeof reviewText>[0], key: Parameters<typeof reviewText>[1], values?: Record<string, string | number>) => reviewText(language, key, values, reviews);
  const extra = resolveInboxCatalog('round3Copy', catalog)[locale];
  const actor ={ userId: viewer.user.id, workspaceId: viewer.workspaceId };
  const constraints = viewer.permissions.pageScope.all ? undefined : { allowedChannelIds: viewer.permissions.pageScope.ids };

  const listOutcome = await (async () => {
    try { return { page: await readInboxList(actor, inboxListInput(params), constraints), error: null }; }
    catch (error) { return { page: null, error: operationFailure(error, copy.listError) }; }
  })();
  const listPage = listOutcome.page;
  const baseLocation = locationFrom(listPage, params);
  const requestedThread = singleValue(params.thread);
  const requestedHistoryCursor = singleValue(params.historyCursor);
  let threadOutcome: { page: InboxThreadPage | null; error: { error: string; code: string; status: number } | null } = { page: null, error: null };
  if (params.thread !== undefined && !requestedThread) {
    threadOutcome = { page: null, error: operationFailure(cursorError('conversation'), copy.threadOpenError) };
  } else if (params.historyCursor !== undefined && !requestedThread) {
    threadOutcome = { page: null, error: operationFailure(cursorError('history cursor'), 'Choose a conversation before opening its history.') };
  } else if (params.historyCursor !== undefined && !requestedHistoryCursor) {
    threadOutcome = { page: null, error: operationFailure(cursorError('history cursor'), 'The conversation history could not be loaded.') };
  } else if (requestedThread) {
    try {
      threadOutcome = { page: await readInboxThread(actor, { key: requestedThread, ...(requestedHistoryCursor ? { cursor: requestedHistoryCursor } : {}) }, constraints), error: null };
    } catch (error) {
      threadOutcome = { page: null, error: operationFailure(error, copy.threadOpenError) };
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
    // Stored facts only; if they cannot be read the panel says so and the conversation itself stays usable.
    const details: InboxContactDetails | null = await readInboxContactDetails(actor, { key: `${thread.kind}:${thread.id}` }, constraints).catch(() => null);
    const badge = channelBadgeInfo(thread.target.provider);
    const first =thread.entries.find(entry => !entry.fromChannel);
    const history = threadPage!.history;
    const childrenOf = new Map<string, ThreadEntry[]>();
    for (const entry of thread.entries) if (entry.parentId) childrenOf.set(entry.parentId, [...(childrenOf.get(entry.parentId) ?? []), entry]);
    // Replies are actionable through the same shared services as the opening comment; the channel module's declared capabilities decide which actions exist.
    const renderEntry = (entry: ThreadEntry): ReactNode => {
      const replies = childrenOf.get(entry.id) ?? [];
      const isReply = entry.parentId !== null;
      return <li key={entry.id} className={styles.entryNode}>
        <div className={styles.entry} data-from={entry.fromChannel ? 'channel' : 'person'} data-reply={isReply || undefined}>
          <div className={styles.entryHead}><strong>{entry.author}</strong>{entry.sentBy ? <span>{copy.sentBy(entry.sentBy)}</span> : null}{entry.hidden ? <InboxTag icon="hidden">{copy.hidden}</InboxTag> : null}<time dateTime={entry.time.toISOString()}>{formatInboxTime(entry.time, timeZone, true)}</time></div>
          <p>{entry.text || copy.noText}</p>
          {isReply && canWrite && (capabilities.hide || capabilities.remove) ? <ThreadToolbar reply id={entry.id} kind="comment" resolved={false} hidden={entry.hidden} canResolve={canWrite} canHide={capabilities.hide} canDelete={capabilities.remove} platformName={badge.platformName} listHref={clearThreadHref} locale={locale} /> : null}
          {isReply && !entry.fromChannel ? <NestedReply id={entry.id} author={entry.author} canReply={canWrite && capabilities.reply} allowed={rule.allowed} /> : null}
        </div>
        {replies.length ? <ol className={styles.replies} aria-label={copy.repliesTo(entry.author)}>{replies.map(reply => renderEntry(reply))}</ol> : null}
      </li>;
    };
    const historyNoun = thread.kind === 'comment' ? copy.replies : copy.messagesNoun;
    const openingItemPresent = Boolean(listPage?.items.some(item => item.key === `${thread.kind}:${thread.id}`));
    threadView = <section className={styles.threadPane} aria-label={thread.kind === 'message' ? copy.openConversation : thread.kind === 'review' ? reviewLabel(locale, 'openReview') : copy.openComment}>
      <a className={styles.back} href={clearThreadHref}>{copy.back}</a>
      {!openingItemPresent && listPage ? <p className={styles.contextNote}>{copy.outsideList}</p> : null}
      <header className={styles.threadHead}>
        <h2>{thread.kind === 'message' ? copy.conversationWith(first?.author ?? copy.aVisitor) : thread.kind === 'review' ? reviewLabel(locale, 'reviewBy', { name: thread.entries[0]?.author ?? copy.aVisitor }) : copy.commentBy(thread.entries[0]?.author ?? copy.aVisitor)}</h2>
        <div className={styles.threadTags}>
          <ChannelBadge name={thread.target.name} platformName={badge.platformName} mark={badge.mark} />
          <InboxTag icon={thread.kind === 'message' ? 'message' : 'comment'}>{thread.kind === 'message' ? copy.message : thread.kind === 'review' ? reviewLabel(locale, 'review') : copy.comment}</InboxTag>
          {thread.kind === 'review' ? <InboxTag icon="comment">{reviewSummary(locale, thread, reviews)}</InboxTag> : null}
          {thread.resolved ? <InboxTag icon="resolved" tone="ok">{copy.resolvedTag}</InboxTag> : <InboxTag icon="needsReply" tone="warn">{copy.openTag}</InboxTag>}
          {thread.hidden ? <InboxTag icon="hidden">{copy.hidden}</InboxTag> : null}
        </div>
      </header>
      <div className={r3.threadGrid}><div className={r3.threadMain}>
      <ThreadScroll label={copy.historyLabel} resetKey={`${thread.kind}:${thread.id}:${requestedHistoryCursor ?? ''}:${history.shown}`}>
      {thread.postText ?<p className={styles.postContext}><strong>{copy.onYourPost}</strong>{thread.postText.length > 280 ? `${thread.postText.slice(0, 280)}…` : thread.postText}</p> : null}
      <p className={styles.contextNote}>{thread.kind === 'review' ? reviewLabel(locale, 'note') : copy.syncedNote}</p>
      <div className={styles.historyHead}>
        <h3>{thread.kind === 'comment' ? copy.commentHistory : thread.kind === 'review' ? reviewLabel(locale, 'reviewHistory') : copy.conversationHistory}</h3>
        <span>{copy.historyShown(history.shown, history.total, historyNoun)}</span>
      </div>
      {history.cursor && history.shown === 0 ? <p className={styles.contextNote}>{copy.noHistory}</p> : null}
      <ol className={styles.entries} aria-label={copy.historyLabel}>
        {(thread.kind === 'comment' ? thread.entries.filter(entry => entry.parentId === null) : thread.entries).map(entry => renderEntry(entry))}
      </ol>
      </ThreadScroll>
      {canResolve ? <ThreadToolbar id={thread.id} kind={thread.kind} resolved={thread.resolved} hidden={thread.hidden} canResolve={canResolve} canHide={canWrite && capabilities.hide} canDelete={canWrite && capabilities.remove} platformName={badge.platformName} listHref={clearThreadHref} locale={locale} /> : null}
      {thread.kind === 'review'
        ? (canWrite && capabilities.replyToReviews ? <ReplyBox key={thread.id} id={thread.id} kind="review" locale={locale} allowed headline="" /> : <p>{reviewLabel(locale, 'replyUnavailable')}</p>)
        : <ThreadTools kind={thread.kind} id={thread.id} canWrite={canWrite} canReply={capabilities.reply} allowed={rule.allowed} headline={rule.headline} detail={rule.detail} locale={locale} />}
      </div>
      <ContactDetails catalog={catalog} details={details} locale={locale} timeZone={timeZone} />
      </div>
    </section>;
  }

  const visibleChannels = listPage?.channels ?? [];
  const quickApplied = listPage?.quick ?? [];
  const filtered = Boolean(filters.channelId || filters.kind !== 'all' || filters.state !== 'open' || filters.hidden !== 'visible' || filters.q || quickApplied.length);

  // What this person may do to each item on the page, decided once per channel and provider. The services re-check on every action.
  const abilities = new Map<string, { write: boolean; resolve: boolean; hide: boolean; remove: boolean }>();
  if (listPage) {
    const targets = [...new Map(listPage.items.map(item => [item.target.id, item.target.provider])).entries()];
    const providers = [...new Set(targets.flatMap(([, provider]) => provider ? [provider] : []))];
    const providerCaps = new Map(await Promise.all(providers.map(async provider => [provider, await inboxCapabilities(provider)] as const)));
    await Promise.all(targets.map(async ([targetId, provider]) => {
      const [write, resolve] = await Promise.all([canManageInbox(actor, targetId), canManageInboxWorkflow(actor, targetId)]);
      const caps = provider ? providerCaps.get(provider) : undefined;
      abilities.set(targetId, { write, resolve, hide: write && Boolean(caps?.hide), remove: write && Boolean(caps?.remove) });
    }));
  }
  const selectables = new Map<string, SelectableItem>();
  for (const item of listPage?.items ?? []) {
    const ability = abilities.get(item.target.id);
    if (!ability) continue;
    const can = { resolve: ability.resolve, hide: item.kind === 'comment' && ability.hide, remove: item.kind === 'comment' && ability.remove };
    if (can.resolve || can.hide || can.remove) selectables.set(item.key, { key: item.key, kind: item.kind, id: item.id, label: item.author, platformName: channelBadgeInfo(item.target.provider).platformName, resolved: item.resolved, hidden: item.hidden, can });
  }
  const canWriteReplies = [...abilities.values()].some(ability => ability.write);
  const syncTarget = channel === 'all' ? undefined : channel;

  const sidebar = <aside className={styles.filters} aria-label={copy.filtersLabel}>
    <InboxFilterPanel action={inboxHref()} filters={filters} channels={visibleChannels} locale={locale} thread={requestedThread} limit={listPage?.limit} maxLimit={listPage?.limits.listPageSize}
      searchMaxCharacters={listPage?.limits.searchMaxCharacters} resetHref="/inbox" disabledLimit={!listPage} quick={listPage?.quick ?? []} />
    <div className={styles.navigationGroup}>
      <p className={styles.filterHeading}>{copy.automation}</p>
      <a href="/inbox/moderation">{copy.moderationRules}</a>
    </div>
    {listPage ? <div className={styles.navigationGroup}>
      <p className={styles.filterHeading}>{copy.conversations}</p>
      <nav className={styles.pagination} aria-label={catalog['navigation.listPages'][locale]}>
        {listPage.olderCursor ? <a href={inboxHref({ ...listPagingLocation, cursor: listPage.olderCursor })}>{copy.older}</a> : <span aria-disabled="true">{copy.older}</span>}
        {listPage.cursor ? <a href={inboxHref({ ...listPagingLocation, cursor: undefined })}>{copy.latest}</a> : <span aria-disabled="true">{copy.latest}</span>}
        {listPage.newerCursor ? <a href={inboxHref({ ...listPagingLocation, cursor: listPage.newerCursor })}>{copy.newer}</a> : <span aria-disabled="true">{copy.newer}</span>}
      </nav>
    </div> : null}
    {threadPage ? <div className={styles.navigationGroup}>
      <p className={styles.filterHeading}>{thread?.kind === 'comment' ? copy.replyHistory : copy.messageHistory}</p>
      <nav className={styles.pagination} aria-label={catalog['navigation.historyPages'][locale]}>
        {threadPage.history.olderCursor ? <a href={inboxHref({ ...baseLocation, ...(listPage?.cursor ? { cursor: listPage.cursor } : {}), thread: `${thread!.kind}:${thread!.id}`, historyCursor: threadPage.history.olderCursor })}>{copy.earlier}</a> : <span aria-disabled="true">{copy.earlier}</span>}
        {threadPage.history.cursor ? <a href={inboxHref({ ...baseLocation, ...(listPage?.cursor ? { cursor: listPage.cursor } : {}), thread: `${thread!.kind}:${thread!.id}` })}>{copy.latest}</a> : <span aria-disabled="true">{copy.latest}</span>}
        {threadPage.history.newerCursor ? <a href={inboxHref({ ...baseLocation, ...(listPage?.cursor ? { cursor: listPage.cursor } : {}), thread: `${thread!.kind}:${thread!.id}`, historyCursor: threadPage.history.newerCursor })}>{copy.newer}</a> : <span aria-disabled="true">{copy.newer}</span>}
      </nav>
    </div> : null}
  </aside>;

  // Applied filters stay visible in the content header; each chip links to the same view without that one filter.
  const without = (...keys: Array<keyof InboxLocation>) => inboxHref({ ...Object.fromEntries(Object.entries(baseLocation).filter(([key]) => !keys.includes(key as keyof InboxLocation))), ...(requestedThread ? { thread: requestedThread } : {}) });
  const typeLabel = filters.kind === 'message' ? copy.messages : filters.kind === 'comment' ? copy.comments : reviewLabel(locale, 'reviews');
  const chips: UrlFilterChip[] = [
    ...(filters.channelId ? [{ key: 'channel', label: copy.channel, value: visibleChannels.find(item => item.id === filters.channelId)?.name ?? filters.channelId, removeHref: without('channel', 'cursor') }] : []),
    ...(filters.kind !== 'all' ? [{ key: 'type', label: copy.type, value: typeLabel, removeHref: without('type', 'cursor') }] : []),
    ...(filters.state !== 'open' ? [{ key: 'status', label: copy.status, value: filters.state === 'resolved' ? copy.resolved : copy.all, removeHref: without('status', 'cursor') }] : []),
    ...(filters.hidden !== 'visible' ? [{ key: 'hidden', label: copy.hiddenComments, value: copy.showThem, removeHref: without('hidden', 'cursor') }] : []),
    ...(filters.q ? [{ key: 'q', label: copy.searchChip, value: filters.q, removeHref: without('q', 'cursor') }] : []),
    // One removable chip per quick filter; removing one keeps the others.
    ...quickApplied.map(filter => ({ key: `quick-${filter}`, label: extra.quick.chip, value: extra.quick[filter], removeHref: inboxHref({ ...Object.fromEntries(Object.entries(baseLocation).filter(([key]) => key !== 'quick' && key !== 'cursor')), ...(quickApplied.length > 1 ? { quick: quickApplied.filter(item => item !== filter).join(',') } : {}), ...(requestedThread ? { thread: requestedThread } : {}) }) })),
  ];

  const listError = listOutcome.error;
  const lastSynced = listPage?.lastSynced ?? null;
  const noChannels = listPage !== null && visibleChannels.length === 0;

  return <InboxCopyProvider catalog={catalog}><PageFrame module="inbox" scopedAccess sidebar={sidebar}><div className={styles.page}>
    <InboxHeader eyebrow={copy.eyebrow} title={copy.title} description={copy.description} actions={visibleChannels.length > 0 ? <InboxSyncBar targetId={syncTarget} lastSynced={lastSynced ? formatInboxTime(lastSynced, timeZone, true) : null} timeZone={timeZone} locale={locale} /> : undefined} />
    <div className={r3.tools}>
      {visibleChannels.length > 0 ? <SavedRepliesManager locale={locale} canWrite={canWriteReplies} /> : null}
      <InboxShortcuts locale={locale} />
    </div>
    {listPage && listPage.items.length > 0 ? <ShortcutHint catalog={catalog} locale={locale} /> : null}
    <UrlFilterChips chips={chips} resetHref={resetHref} labels={{ active: copy.activeFilters, remove: copy.removeFilter, reset: copy.resetFilters }} />
    {listError ? <div role="alert" className={styles.alert}><p>{listError.error}</p><a href={resetHref}>{copy.resetAndReturn}</a></div> : null}
    {threadOutcome.error ? <div role="alert" className={styles.alert}><p>{threadOutcome.error.error}</p><a href={clearThreadHref}>{copy.returnToList}</a></div> : null}
    {noChannels ? <section className="panel"><EmptyState icon={<IconPlugConnected size={26} />} title={copy.noChannelsTitle} action={<a className="ui-button ui-button--primary" href="/settings/connections">{copy.goConnections}</a>}>{copy.noChannelsBody}</EmptyState></section> : listPage ? <div className={styles.split} data-open={thread ? 'true' : 'false'}>
      <section className={styles.listPane} aria-label={copy.conversationsAndComments}>
        <div className={styles.listHead}><h2>{filters.state === 'resolved' ? copy.resolved : filters.state === 'all' ? copy.allActivity : copy.open}</h2><span>{copy.items(listPage.items.length, listPage.total)}</span></div>
        {listPage.items.length ? <InboxSelectionProvider pageItems={[...selectables.values()]}>
        {selectables.size ? <BulkBar locale={locale} maxItems={listPage.limits.bulkMaxItems ?? listPage.limit} /> : null}
        <ul className={styles.list}>{listPage.items.map(item => {
          const badge = channelBadgeInfo(item.target.provider);
          const selected = thread !== null && thread.kind === item.kind && thread.id === item.id;
          const selectable = selectables.get(item.key);
          return <li key={item.key} className={selectables.size ? r3.row : undefined}>{selectables.size ? <span className={r3.rowSelect}>{selectable ? <SelectBox item={selectable} label={extra.bulk.selectItem(item.author)} /> : null}</span> : null}<a className={styles.item} href={inboxHref({ ...baseLocation, ...(listPage.cursor ? { cursor: listPage.cursor } : {}), thread: item.key })} aria-current={selected ? 'true' : undefined} data-attention={item.needsReply || item.unread > 0 || undefined} data-inbox-item>
            <PersonAvatar name={item.author} size={38} />
            <div className={styles.itemBody}>
            <div className={styles.itemTop}><span className={styles.author}>{item.unread > 0 || item.needsReply ? <span className={styles.unreadDot} role="img" aria-label={copy.unread} /> : null}{item.author}</span><time dateTime={item.time.toISOString()}>{formatInboxTime(item.time, timeZone)}</time></div>
            <p className={styles.preview}>{item.kind === 'review' && !item.preview ? reviewLabel(locale, 'noText') : item.preview.length > 180 ? `${item.preview.slice(0, 180)}…` : item.preview}</p>
            <div className={styles.itemMeta}>
              <ChannelBadge name={item.target.name} platformName={badge.platformName} mark={badge.mark} compact />
              <InboxTag icon={item.kind === 'message' ? 'message' : 'comment'}>{item.kind === 'message' ? copy.message : item.kind === 'review' ? reviewLabel(locale, 'review') : copy.comment}</InboxTag>
              {item.kind === 'review' ? <InboxTag icon="comment">{reviewSummary(locale, item, reviews)}</InboxTag> : null}
              {item.sentiment ? <InboxTag icon={item.sentiment} tone={SENTIMENT_TONE[item.sentiment]} title={copy.sentimentHint}>{copy.sentiment[item.sentiment]}</InboxTag> : null}
              {item.unread > 0 ? <InboxTag icon="unread" tone="warn">{copy.nUnread(item.unread)}</InboxTag> : null}
              {item.needsReply ? <InboxTag icon="needsReply" tone="warn">{copy.needsReply}</InboxTag> : null}
              {item.resolved ? <InboxTag icon="resolved" tone="ok">{copy.resolvedTag}</InboxTag> : null}
              {item.hidden ? <InboxTag icon="hidden">{copy.hidden}</InboxTag> : null}
            </div>
            </div>
          </a></li>;
        })}</ul></InboxSelectionProvider> : listPage.total > 0 && listPage.cursor
          ? <EmptyState icon={<IconInboxOff size={26} />} title={copy.emptyPageTitle} action={<a className="ui-button ui-button--secondary" href={inboxHref({ ...listPagingLocation, cursor: undefined })}>{copy.showLatest}</a>}>{copy.emptyPageBody}</EmptyState>
          : filtered
            ? quickApplied.length
              ? <EmptyState icon={<IconInboxOff size={26} />} title={extra.quick.noMatchTitle} action={<a className="ui-button ui-button--secondary" href={resetHref}>{copy.resetFilters}</a>}>{extra.quick.noMatchBody}</EmptyState>
              : <EmptyState icon={<IconInboxOff size={26} />} title={copy.noMatchTitle} action={<a className="ui-button ui-button--secondary" href="/inbox">{copy.resetFilters}</a>}>{copy.noMatchBody}</EmptyState>
            : lastSynced
              ? <EmptyState icon={<IconInbox size={26} />} title={copy.noOpenTitle} action={<a className="ui-button ui-button--secondary" href="/inbox?status=resolved">{copy.showResolved}</a>}>{copy.noOpenBody}</EmptyState>
              : <EmptyState icon={<IconInbox size={26} />} title={copy.emptyTitle}>{copy.emptyBody}</EmptyState>}
      </section>
      {threadView ?? <section className={`${styles.threadPane} ${styles.pick}`} aria-label={copy.openConversation}><EmptyState icon={<IconMessages size={26} />} title={copy.selectTitle}>{copy.selectBody}</EmptyState></section>}
    </div> : null}
  </div></PageFrame></InboxCopyProvider>;
}
