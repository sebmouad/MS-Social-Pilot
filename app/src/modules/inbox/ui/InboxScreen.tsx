import { createHash } from 'node:crypto';
import { loadInboxCustomerCopy } from '@/modules/inbox/server/customer-copy';
import { resolveInboxCatalog } from '@/modules/inbox/customer-copy';
import { InboxCopyProvider } from '@/modules/inbox/ui/copy-context';
import { IconInbox, IconInboxOff, IconMessages, IconPlugConnected } from '@tabler/icons-react';
import { ChannelBadge, EmptyState, InfoTip, LinkTabs } from '@/components';
import { shellChrome } from '@/modules/shell/server/chrome';
import { OperationError, operationFailure } from '@/lib/operation-error';
import { channelBadgeInfo } from '@/lib/channel-badge';
import { inboxHref, inboxListInput, type InboxLocation, type InboxSearchParams } from '@/modules/inbox/query';
import type { ReactNode } from 'react';
import { INBOX_QUICK_FILTERS, type InboxFilters, type InboxListPage, type InboxThreadPage, type OpenThread, type ThreadEntry } from '@/modules/inbox/server/types';
import { readInboxList, readInboxThread } from '@/modules/inbox/server/read';
import { PageFrame } from '@/server/PageFrame';
import { requireViewer } from '@/server/context';
import { canManageInbox, canManageInboxWorkflow } from '@/modules/inbox/server/actions';
import { inboxReplyPolicy } from '@/modules/inbox/server/policy';
import { inboxCapabilities } from '@/modules/inbox/server/providers';
import { formatInboxTime } from '@/modules/inbox/server/threads';
import { UrlFilterChips, type UrlFilterChip } from '@/modules/publishing/ui/kit/UrlFilterChips';
import { aiStatus } from '@/modules/studio/server/ai';
import { InboxSyncBar, ReplyBox, ThreadToolbar } from './InboxActions';
import { reviewSummary, reviewText } from '@/modules/inbox/reviews-copy';
import { ThreadTools } from './ThreadTools';
import { NestedReply } from './NestedReply';
import { InboxTag, inboxKindTone } from './InboxTags';
import { InboxHeader, PersonAvatar } from './InboxChrome';
import { InboxFilterRow } from './InboxFilterRow';
import { InboxSavedViews } from './InboxSavedViews';
import { ThreadDetailsLayout } from './ThreadDetailsLayout';
import { InboxShortcuts } from './InboxShortcuts';
import { ContactDetails } from './ContactDetails';
import { ThreadScroll } from './ThreadScroll';
import { InboxList } from './InboxList';
import { inboxListAbilities, inboxListRows } from './InboxListRows';
import { loadMoreInboxRows } from './list-action';
import { runtimeConfig } from '@/server/config/store';
import { SavedRepliesManager } from './SavedRepliesManager';
import { readInboxContactDetails } from '@/modules/inbox/server/details';
import type { InboxContactDetails } from '@/modules/inbox/details';
import { inboxLocale } from './locale';
import { inboxScope } from './scope';
import { inboxSyncStale } from '@/modules/inbox/server/freshness';
import { firstAttachment, safePermalink } from './attachments';
import styles from './inbox.module.css';

const DEFAULT_FILTERS: InboxFilters = { channelId: null, kind: 'message', state: 'open', hidden: 'visible', q: '' };
const KIND_TABS = ['message', 'comment', 'review'] as const;
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
  const { copy: shell } = await shellChrome();
  const actor ={ userId: viewer.user.id, workspaceId: viewer.workspaceId };
  // The channel list in the sidebar scopes the Inbox; the page has no channel filter of its own.
  const scope = await inboxScope(viewer, params.channel);
  const constraints = scope.constraints;
  const { channel: _scopeParam, ...listParams } = params;

  // The screen shows one explicit list at a time; an absent or legacy mixed `type` opens the first non-empty list
  // (Messages when all are empty). The service still accepts `all` for API/MCP callers.
  const listInput = inboxListInput(listParams);
  const kindChosen = listInput.kind !== undefined && listInput.kind !== 'all';
  if (!kindChosen) listInput.kind = 'message';
  const listOutcome = await (async () => {
    try {
      const first = await readInboxList(actor, listInput, constraints);
      const fallback = kindChosen || first.total > 0 ? undefined : KIND_TABS.find(kind => (first.totals?.[kind] ?? 0) > 0);
      return { page: fallback ? await readInboxList(actor, { ...listInput, kind: fallback }, constraints) : first, error: null };
    }
    catch (error) { return { page: null, error: operationFailure(error, copy.listError) }; }
  })();
  const listPage = listOutcome.page;
  const baseLocation: InboxLocation = { ...locationFrom(listPage, params), ...(scope.param ? { channel: scope.param } : {}) };
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
  // The open list is an explicit choice, never a mix; reset keeps it (legacy `all` folds to Messages).
  const activeKind = filters.kind === 'all' ? 'message' : filters.kind;
  const resetHref = inboxHref({ type: activeKind, ...(threadOutcome.page && requestedThread ? { thread: requestedThread } : {}) });
  const listPagingLocation = {
    ...baseLocation,
    ...(threadPage && requestedThread ? { thread: requestedThread } : {}),
    ...(threadPage && requestedHistoryCursor ? { historyCursor: requestedHistoryCursor } : {}),
  };

  let threadView = null;
  if (thread) {
    const [canWrite, canResolve, capabilities, rule, aiAvailable] = await Promise.all([
      canManageInbox(actor, thread.target.id),
      canManageInboxWorkflow(actor, thread.target.id),
      thread.target.provider ? inboxCapabilities(thread.target.provider) : Promise.resolve({ reply: false, hide: false, remove: false, reviews: false, replyToReviews: false, privateReply: false }),
      thread.kind === 'review' ? Promise.resolve({ allowed: false, headline: '', detail: undefined }) : inboxReplyPolicy(thread.target.provider, { kind: thread.kind, channelRemoteId: thread.target.providerId, lastInbound: thread.lastInbound, timeZone }),
      aiStatus(actor).then(status => status.available, () => false),
    ]);
    // Stored facts only; if they cannot be read the panel says so and the conversation itself stays usable.
    const details: InboxContactDetails | null = await readInboxContactDetails(actor, { key: `${thread.kind}:${thread.id}` }, constraints).catch(() => null);
    const badge = channelBadgeInfo(thread.target.provider);
    const first =thread.entries.find(entry => !entry.fromChannel);
    const history = threadPage!.history;
    const childrenOf = new Map<string, ThreadEntry[]>();
    for (const entry of thread.entries) if (entry.parentId) childrenOf.set(entry.parentId, [...(childrenOf.get(entry.parentId) ?? []), entry]);
    // Replies are actionable through the same shared services as the opening comment; the channel module's declared capabilities decide which actions exist.
    const attachmentOf = (entry: ThreadEntry) => firstAttachment(entry.metadata);
    const renderEntry = (entry: ThreadEntry): ReactNode => {
      const replies = childrenOf.get(entry.id) ?? [];
      const isReply = entry.parentId !== null;
      return <li key={entry.id} className={styles.entryNode}>
        <div className={styles.entry} data-from={entry.fromChannel ? 'channel' : 'person'} data-reply={isReply || undefined}>
          <div className={styles.entryHead}><strong>{entry.author}</strong>{entry.sentBy ? <span>{copy.sentBy(entry.sentBy)}</span> : null}{entry.hidden ? <InboxTag icon="hidden">{copy.hidden}</InboxTag> : null}<time dateTime={entry.time.toISOString()}>{formatInboxTime(entry.time, timeZone, true, locale)}</time></div>
          {entry.text || !attachmentOf(entry) ? <p>{entry.text || (thread.kind === 'comment' ? copy.commentNoText : copy.noText)}</p> : null}
          {(() => { const attachment = attachmentOf(entry); if (!attachment) return null; const label = copy.attachment[attachment.kind];
            return attachment.url && attachment.kind !== 'link' && attachment.kind !== 'other'
              ? <img className={styles.entryImage} src={attachment.url} alt={label} loading="lazy" referrerPolicy="no-referrer" />
              : attachment.url ? <a href={attachment.url} target="_blank" rel="noopener noreferrer">{label}</a> : <p className={styles.contextNote}>{label}</p>; })()}
          {safePermalink(entry.metadata) ? <a className={styles.permalink} href={safePermalink(entry.metadata)!} target="_blank" rel="noopener noreferrer">{copy.openOriginal(badge.platformName)}</a> : null}
          {isReply && canWrite && (capabilities.hide || capabilities.remove) ? <ThreadToolbar reply id={entry.id} kind="comment" resolved={false} hidden={entry.hidden} canResolve={canWrite} canHide={capabilities.hide} canDelete={capabilities.remove} platformName={badge.platformName} listHref={clearThreadHref} locale={locale} /> : null}
          {isReply && !entry.fromChannel ? <NestedReply id={entry.id} author={entry.author} canReply={canWrite && capabilities.reply} allowed={rule.allowed} /> : null}
        </div>
        {replies.length ? <ol className={styles.replies} aria-label={copy.repliesTo(entry.author)}>{replies.map(reply => renderEntry(reply))}</ol> : null}
      </li>;
    };
    const historyNoun = thread.kind === 'comment' ? copy.replies : copy.messagesNoun;
    const openingItemPresent = Boolean(listPage?.items.some(item => item.key === `${thread.kind}:${thread.id}`));
    const historyBase = { ...baseLocation, ...(listPage?.cursor ? { cursor: listPage.cursor } : {}), thread: `${thread.kind}:${thread.id}` };
    const historyNav = <nav className={styles.pagination} aria-label={catalog['navigation.historyPages'][locale]}>
      {history.olderCursor ? <a href={inboxHref({ ...historyBase, historyCursor: history.olderCursor })}>{copy.earlier}</a> : <span aria-disabled="true">{copy.earlier}</span>}
      {history.cursor ? <a href={inboxHref(historyBase)}>{copy.latest}</a> : <span aria-disabled="true">{copy.latest}</span>}
      {history.newerCursor ? <a href={inboxHref({ ...historyBase, historyCursor: history.newerCursor })}>{copy.newer}</a> : <span aria-disabled="true">{copy.newer}</span>}
    </nav>;
    const head = <header className={styles.threadHead}>
      <PersonAvatar name={first?.author ?? thread.entries[0]?.author ?? copy.aVisitor} size={44} />
      <h2>{thread.kind === 'message' ? copy.conversationWith(first?.author ?? copy.aVisitor) : thread.kind === 'review' ? reviewLabel(locale, 'reviewBy', { name: thread.entries[0]?.author ?? copy.aVisitor }) : copy.commentBy(thread.entries[0]?.author ?? copy.aVisitor)}</h2>
      <p className={styles.audience} data-kind={thread.kind}>{thread.kind === 'message' ? copy.audiencePrivate(first?.author ?? copy.aVisitor) : thread.kind === 'review' ? reviewLabel(locale, 'audience') : copy.audiencePublic}</p>
      <div className={styles.threadTags}>
        <ChannelBadge name={thread.target.name} platformName={badge.platformName} mark={badge.mark} />
        <InboxTag icon={thread.kind === 'message' ? 'message' : thread.kind === 'review' ? 'review' : 'comment'} tone={inboxKindTone(thread.kind)}>{thread.kind === 'message' ? copy.message : thread.kind === 'review' ? reviewLabel(locale, 'review') : copy.comment}</InboxTag>
        {thread.kind === 'review' ? <InboxTag icon="review">{reviewSummary(locale, thread, reviews)}</InboxTag> : null}
        {thread.resolved ? <InboxTag icon="resolved" tone="ok">{copy.resolvedTag}</InboxTag> : <InboxTag icon="needsReply" tone="warn">{copy.openTag}</InboxTag>}
        {thread.hidden ? <InboxTag icon="hidden">{copy.hidden}</InboxTag> : null}
      </div>
    </header>;
    // Resolve and the moderation buttons sit in the thread header, so they stay in reach on a phone.
    const headActions = canResolve ? <ThreadToolbar id={thread.id} kind={thread.kind} resolved={thread.resolved} hidden={thread.hidden} canResolve={canResolve} canHide={canWrite && capabilities.hide} canDelete={canWrite && capabilities.remove} platformName={badge.platformName} listHref={clearThreadHref} locale={locale} /> : null;
    const main = <>
      <ThreadScroll label={copy.historyLabel} resetKey={`${thread.kind}:${thread.id}:${requestedHistoryCursor ?? ''}`}>
      {thread.postText ?<p className={styles.postContext}><strong>{copy.onYourPost}</strong>{thread.postText.length > 280 ? `${thread.postText.slice(0, 280)}…` : thread.postText}{thread.postId ? <> <a href={`/content/post/${encodeURIComponent(thread.postId)}`}>{copy.openPost}</a></> : null}</p> : null}
      <p className={styles.contextNote}>{thread.kind === 'review' ? reviewLabel(locale, 'note') : copy.syncedNote}</p>
      <div className={styles.historyHead}>
        <h3>{thread.kind === 'comment' ? copy.commentHistory : thread.kind === 'review' ? reviewLabel(locale, 'reviewHistory') : copy.conversationHistory}</h3>
        <span>{copy.historyShown(history.shown, history.total, historyNoun)}</span>
        {history.olderCursor || history.newerCursor || history.cursor ? historyNav : null}
      </div>
      {history.cursor && history.shown === 0 ? <p className={styles.contextNote}>{copy.noHistory}</p> : null}
      <ol className={styles.entries} aria-label={copy.historyLabel}>
        {(thread.kind === 'comment' ? thread.entries.filter(entry => entry.parentId === null) : thread.entries).map(entry => renderEntry(entry))}
      </ol>
      </ThreadScroll>
      <div className={styles.replyDock}>
        {thread.kind === 'review'
          ? (canWrite && capabilities.replyToReviews ? <ReplyBox key={thread.id} id={thread.id} kind="review" locale={locale} allowed headline="" /> : <p>{reviewLabel(locale, 'replyUnavailable')}</p>)
          : <ThreadTools kind={thread.kind} id={thread.id} canWrite={canWrite} canReply={capabilities.reply} allowed={rule.allowed} headline={rule.headline} detail={rule.detail} locale={locale} source={[...thread.entries].reverse().find(entry => !entry.fromChannel)?.text} aiAvailable={aiAvailable} />}
      </div>
    </>;
    threadView = <section className={styles.threadPane} aria-label={thread.kind === 'message' ? copy.openConversation : thread.kind === 'review' ? reviewLabel(locale, 'openReview') : copy.openComment}>
      <a className={styles.back} href={clearThreadHref}>{copy.back}</a>
      {!openingItemPresent && listPage ? <p className={styles.contextNote}>{copy.outsideList}</p> : null}
      <ThreadDetailsLayout head={head} actions={headActions} main={main} details={<ContactDetails catalog={catalog} details={details} locale={locale} timeZone={timeZone} />} locale={locale} />
    </section>;
  }

  const visibleChannels = listPage?.channels ?? [];
  const quickApplied = listPage?.quick ?? [];
  const filtered = Boolean(filters.channelId || filters.state !== 'open' || filters.hidden !== 'visible' || filters.q || quickApplied.length);

  const abilities = listPage ? await inboxListAbilities(actor, listPage) : new Map();
  const canWriteReplies = [...abilities.values()].some(ability => ability.write);
  const [progressivePageLimit, previewMaxCharacters, staleAfterMinutes] = await Promise.all([runtimeConfig('inbox.progressivePageLimit'), runtimeConfig('inbox.listPreviewMaxCharacters'), runtimeConfig('inbox.syncStaleAfterMinutes')]);
  const rows = listPage ? inboxListRows(listPage, abilities, baseLocation, requestedThread, locale, catalog, previewMaxCharacters) : [];
  // A scope, data or grant change starts a new browsing surface, invalidating
  // pending continuations and preventing older loaded rows surviving a refresh.
  const listRevision = createHash('sha256').update(JSON.stringify({ actor, constraints, channels: listPage?.channels, locale, baseLocation, cursor: listPage?.cursor, thread: requestedThread, items: listPage?.items, abilities: [...abilities], total: listPage?.total, progressivePageLimit, previewMaxCharacters })).digest('hex');
  const syncTarget = scope.ids.length === 1 ? scope.ids[0] : undefined;

  const listNav = listPage ? <nav className={styles.listPaging} aria-label={catalog['navigation.listPages'][locale]}>
    {listPage.olderCursor ? <a href={inboxHref({ ...listPagingLocation, cursor: listPage.olderCursor })}>{copy.older}</a> : <span aria-disabled="true">{copy.older}</span>}
    {listPage.cursor ? <a href={inboxHref({ ...listPagingLocation, cursor: undefined })}>{copy.latest}</a> : <span aria-disabled="true">{copy.latest}</span>}
    {listPage.newerCursor ? <a href={inboxHref({ ...listPagingLocation, cursor: listPage.newerCursor })}>{copy.newer}</a> : <span aria-disabled="true">{copy.newer}</span>}
  </nav> : null;
  // Quick filters are links, so they work without script and keep every other filter; each one toggles itself.
  const quickHref = (filter: (typeof INBOX_QUICK_FILTERS)[number]) => {
    const next = quickApplied.includes(filter) ? quickApplied.filter(item => item !== filter) : [...quickApplied, filter];
    return inboxHref({ ...Object.fromEntries(Object.entries(baseLocation).filter(([key]) => key !== 'quick' && key !== 'cursor')), ...(next.length ? { quick: next.join(',') } : {}), ...(requestedThread ? { thread: requestedThread } : {}) });
  };
  const quickRow = listPage ? <div className={styles.quickRow} role="group" aria-label={extra.screen.quickRow}>
    {INBOX_QUICK_FILTERS.map(filter => <a key={filter} href={quickHref(filter)} className={styles.quickChip} aria-current={quickApplied.includes(filter) ? 'true' : undefined} title={extra.quick.hint[filter]}>{extra.quick[filter]}</a>)}
  </div> : null;

  // Messages, comments and reviews open as separate lists. Switching keeps the channel scope and every other filter; only the kind, cursor and open thread change.
  const kindHref = (kind: (typeof KIND_TABS)[number]) => inboxHref({ ...Object.fromEntries(Object.entries(baseLocation).filter(([key]) => key !== 'type' && key !== 'cursor' && key !== 'thread' && key !== 'historyCursor')), type: kind });
  const kindLabel = (kind: (typeof KIND_TABS)[number]) => kind === 'message' ? copy.messages : kind === 'comment' ? copy.comments : reviewLabel(locale, 'reviews');
  const kindTabs = listPage ? <nav className={styles.kindTabs} aria-label={copy.listsLabel}>
    {KIND_TABS.map(kind => {
      const unread = kind === 'message' ? listPage.unread?.message ?? 0 : 0;
      return <a key={kind} href={kindHref(kind)} className={styles.kindTab} data-kind={kind} aria-current={activeKind === kind ? 'page' : undefined}>
        <InboxTag icon={kind} tone={inboxKindTone(kind)}>{kindLabel(kind)}</InboxTag>
        {listPage.totals ? <span className={styles.kindCount}>{listPage.totals[kind]}</span> : null}
        {unread > 0 ? <InboxTag icon="unread" tone="warn">{copy.nUnread(unread)}</InboxTag> : null}
      </a>;
    })}
  </nav> : null;
  const stateLabel = filters.state === 'resolved' ? copy.resolved : filters.state === 'all' ? copy.allActivity : copy.open;
  const listTitle = `${kindLabel(activeKind)} · ${stateLabel}`;
  const resolvedHref = inboxHref({ ...Object.fromEntries(Object.entries(baseLocation).filter(([key]) => key !== 'status' && key !== 'cursor' && key !== 'thread' && key !== 'historyCursor')), status: 'resolved', ...(requestedThread ? { thread: requestedThread } : {}) });
  const noMatchBody = activeKind === 'comment' ? copy.noMatchBodyComment : activeKind === 'review' ? copy.noMatchBodyReview : copy.noMatchBodyMessage;
  const noOpenTitle = activeKind === 'comment' ? copy.noOpenCommentsTitle : activeKind === 'review' ? copy.noOpenReviewsTitle : copy.noOpenMessagesTitle;
  const noOpenBody = activeKind === 'comment' ? copy.noOpenCommentsBody : activeKind === 'review' ? copy.noOpenReviewsBody : copy.noOpenMessagesBody;
  const emptyBody = activeKind === 'comment' ? copy.emptyBodyComment : activeKind === 'review' ? copy.emptyBodyReview : copy.emptyBodyMessage;

  // Applied filters stay visible in the content header; each chip links to the same view without that one filter.
  const without = (...keys: Array<keyof InboxLocation>) => inboxHref({ ...Object.fromEntries(Object.entries(baseLocation).filter(([key]) => !keys.includes(key as keyof InboxLocation))), ...(requestedThread ? { thread: requestedThread } : {}) });
  const chips: UrlFilterChip[] = [
    ...(filters.channelId ? [{ key: 'channel', label: copy.channel, value: visibleChannels.find(item => item.id === filters.channelId)?.name ?? filters.channelId, removeHref: without('channel', 'cursor') }] : []),
    // The kind tabs above the list already show and switch the type, so it is not a removable filter chip.
    ...(filters.state !== 'open' ? [{ key: 'status', label: copy.status, value: filters.state === 'resolved' ? copy.resolved : copy.all, removeHref: without('status', 'cursor') }] : []),
    ...(filters.hidden !== 'visible' ? [{ key: 'hidden', label: copy.hiddenComments, value: copy.showThem, removeHref: without('hidden', 'cursor') }] : []),
    ...(filters.q ? [{ key: 'q', label: copy.searchChip, value: filters.q, removeHref: without('q', 'cursor') }] : []),
    // One removable chip per quick filter; removing one keeps the others.
    ...quickApplied.map(filter => ({ key: `quick-${filter}`, label: extra.quick.chip, value: extra.quick[filter], removeHref: inboxHref({ ...Object.fromEntries(Object.entries(baseLocation).filter(([key]) => key !== 'quick' && key !== 'cursor')), ...(quickApplied.length > 1 ? { quick: quickApplied.filter(item => item !== filter).join(',') } : {}), ...(requestedThread ? { thread: requestedThread } : {}) }) })),
  ];

  const listError = listOutcome.error;
  const lastSynced = listPage?.lastSynced ?? null;
  const noChannels = listPage !== null && visibleChannels.length === 0;

  const tabs = <LinkTabs label={extra.screen.tabsLabel} moreLabel={shell.moreTabs} activeId="conversations"
    items={[{ id: 'conversations', href: '/inbox', label: extra.screen.tabConversations }, { id: 'rules', href: '/inbox/rules', label: extra.screen.tabRules }]} />;
  const filterRow = <div className={styles.filterTools}>
    <InboxFilterRow action={inboxHref()} filters={filters} scope={scope.param} locale={locale} thread={requestedThread} limit={listPage?.limit} maxLimit={listPage?.limits.listPageSize}
      searchMaxCharacters={listPage?.limits.searchMaxCharacters} resetHref={resetHref} disabledLimit={!listPage} quick={quickApplied} activeCount={chips.length} />
    <InboxSavedViews locale={locale} currentQuery={new URLSearchParams(Object.entries(baseLocation).flatMap(([key, value]) => value === undefined ? [] : [[key, value]])).toString()} />
    <UrlFilterChips chips={chips} resetHref={resetHref} labels={{ active: copy.activeFilters, remove: copy.removeFilter, reset: copy.resetFilters }} />
  </div>;

  return <InboxCopyProvider catalog={catalog}><PageFrame module="inbox" scopedAccess><div className={styles.page}>
    <InboxHeader title={copy.title} count={listPage && filters.state === 'open' ? (listPage.totals ? KIND_TABS.reduce((sum, kind) => sum + (listPage.totals?.[kind] ?? 0), 0) : listPage.total) : undefined} info={<InfoTip name={copy.title}>{copy.description}</InfoTip>} tabs={tabs} filters={filterRow}
      actions={<>
        {visibleChannels.length > 0 ? <InboxSyncBar targetId={syncTarget} lastSynced={lastSynced ? formatInboxTime(lastSynced, timeZone, true, locale) : null} stale={inboxSyncStale(lastSynced, staleAfterMinutes)} incomplete={listPage?.syncIncomplete ?? false} timeZone={timeZone} locale={locale} /> : null}
        {visibleChannels.length > 0 ? <SavedRepliesManager locale={locale} canWrite={canWriteReplies} /> : null}
        <InboxShortcuts locale={locale} />
      </>} />
    {listError ? <div role="alert" className={styles.alert}><p>{listError.error}</p><a href={resetHref}>{copy.resetAndReturn}</a></div> : null}
    {threadOutcome.error ? <div role="alert" className={styles.alert}><p>{threadOutcome.error.error}</p><a href={clearThreadHref}>{copy.returnToList}</a></div> : null}
    {noChannels ? <section className="panel"><EmptyState icon={<IconPlugConnected size={26} />} title={copy.noChannelsTitle} action={<a className="ui-button ui-button--primary" href="/settings/channels">{copy.goConnections}</a>}>{copy.noChannelsBody}</EmptyState></section> : listPage ? <div className={styles.split} data-open={thread ? 'true' : 'false'}>
      <section className={styles.listPane} aria-label={listTitle}>
        {kindTabs}
        {quickRow}
        {!listPage.items.length ? <div className={styles.listHead}><h2>{listTitle}</h2><span>{copy.itemsAll(0)}</span></div> : null}
        {listPage.items.length ? <InboxList key={listRevision} rows={rows} total={listPage.total} olderCursor={listPage.olderCursor} location={{ ...baseLocation, ...(requestedThread ? { thread: requestedThread } : {}) }}
          locale={locale} title={listTitle}
          maxItems={listPage.limits.bulkMaxItems ?? listPage.limit} pageLimit={progressivePageLimit} loadMoreAction={loadMoreInboxRows} /> : listPage.total > 0 && listPage.cursor
          ? <EmptyState icon={<IconInboxOff size={26} />} title={copy.emptyPageTitle} action={<a className="ui-button ui-button--secondary" href={inboxHref({ ...listPagingLocation, cursor: undefined })}>{copy.showLatest}</a>}>{copy.emptyPageBody}</EmptyState>
          : filtered
            ? quickApplied.length
              ? <EmptyState icon={<IconInboxOff size={26} />} title={extra.quick.noMatchTitle} action={<a className="ui-button ui-button--secondary" href={resetHref}>{copy.resetFilters}</a>}>{extra.quick.noMatchBody}</EmptyState>
              : <EmptyState icon={<IconInboxOff size={26} />} title={copy.noMatchTitle} action={<a className="ui-button ui-button--secondary" href={resetHref}>{copy.resetFilters}</a>}>{noMatchBody}</EmptyState>
            : lastSynced
              ? <EmptyState icon={<IconInbox size={26} />} title={noOpenTitle} action={<a className="ui-button ui-button--secondary" href={resolvedHref}>{copy.showResolved}</a>}>{noOpenBody}</EmptyState>
              : <EmptyState icon={<IconInbox size={26} />} title={copy.emptyTitle}>{emptyBody}</EmptyState>}
        {listNav}
      </section>
      {threadView ?? <section className={`${styles.threadPane} ${styles.pick}`} aria-label={copy.openConversation}><EmptyState icon={<IconMessages size={26} />} title={copy.selectTitle}>{copy.selectBody}</EmptyState></section>}
    </div> : null}
  </div></PageFrame></InboxCopyProvider>;
}
