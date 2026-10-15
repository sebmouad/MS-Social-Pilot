import { ChannelBadge } from '@/components';
import { PageFrame } from '@/server/PageFrame';
import { enabledSocialAccountWhere } from '@/server/platforms/registry';
import { requireViewer } from '@/server/context';
import { prisma } from '@/server/data';
import { canAccessPage } from '@/server/permissions';
import { canManageInbox } from '@/server/inbox/actions';
import { runtimeConfig } from '@/server/config/store';
import { messengerReplyWindow } from '@/server/inbox/reply-window';
import { inboxProviders, inboxCapabilities, inboxChannelKinds } from '@/server/inbox/providers';
import { inboxLastSynced, listInboxItems, loadThread, type InboxFilters } from '@/server/inbox/overview';
import { formatInboxTime, replyRule } from '@/server/inbox/threads';
import { channelBadgeInfo } from '@/lib/channel-badge';
import { InboxSyncBar, ReplyBox, ThreadToolbar } from './InboxActions';
import { InboxTag } from './InboxTags';
import styles from './inbox.module.css';

type SearchParams = { channel?: string; type?: string; status?: string; hidden?: string; thread?: string };
const valid = <T extends string>(value: string | undefined, choices: readonly T[], fallback: T): T => value && (choices as readonly string[]).includes(value) ? value as T : fallback;

export default async function InboxPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const viewer = await requireViewer({ feature: 'inbox/conversations' });
  const timeZone = viewer.membership.workspace.timezone;
  const params = await searchParams;
  const kind = valid(params.type, ['all', 'message', 'comment'] as const, 'all');
  const status = valid(params.status, ['open', 'resolved', 'all'] as const, 'open');
  const hidden = valid(params.hidden, ['visible', 'all'] as const, 'visible');

  const channels = await prisma.target.findMany({
    where: { workspaceId: viewer.workspaceId, type: { in: await inboxChannelKinds() }, enabled: true, socialAccount: { is: { provider: { in: await inboxProviders() }, invalidatedAt: null, AND: [await enabledSocialAccountWhere()] } } },
    orderBy: { name: 'asc' }, select: { id: true, name: true },
  });
  const visibleChannels = channels.filter(channel => canAccessPage(viewer.permissions, channel.id));
  const selectedChannel = visibleChannels.some(channel => channel.id === params.channel) ? params.channel! : 'all';
  const channelIds = selectedChannel === 'all' ? visibleChannels.map(channel => channel.id) : [selectedChannel];
  const allVisibleIds = visibleChannels.map(channel => channel.id);
  const filters: InboxFilters = { channelIds, kind, status, hidden };

  const [{ items, truncated }, lastSynced, thread, replyWindowHours] = await Promise.all([
    listInboxItems(viewer.workspaceId, filters),
    inboxLastSynced(viewer.workspaceId, allVisibleIds),
    params.thread ? loadThread(viewer.workspaceId, allVisibleIds, params.thread) : Promise.resolve(null),
    runtimeConfig('inbox.messengerReplyWindowHours') as Promise<number>,
  ]);

  const query = (extra: Record<string, string> = {}) => {
    const search = new URLSearchParams();
    if (selectedChannel !== 'all') search.set('channel', selectedChannel);
    if (kind !== 'all') search.set('type', kind);
    if (status !== 'open') search.set('status', status);
    if (hidden !== 'visible') search.set('hidden', hidden);
    for (const [key, value] of Object.entries(extra)) search.set(key, value);
    const text = search.toString();
    return text ? `/inbox?${text}` : '/inbox';
  };
  const filtered = selectedChannel !== 'all' || kind !== 'all' || status !== 'open' || hidden !== 'visible';

  // The open thread: what the person may do with it, and the platform's reply rule.
  let threadView = null;
  if (thread) {
    const [canWrite, capabilities] = await Promise.all([
      canManageInbox({ userId: viewer.user.id, workspaceId: viewer.workspaceId }, thread.target.id),
      thread.target.provider ? inboxCapabilities(thread.target.provider) : Promise.resolve({ reply: false, hide: false, remove: false }),
    ]);
    const badge = channelBadgeInfo(thread.target.provider);
    const rule = thread.kind === 'message'
      ? replyRule({ kind: 'message', window: messengerReplyWindow({ messages: thread.lastInbound ? [thread.lastInbound] : [], pageId: thread.target.providerId, windowHours: replyWindowHours }), windowHours: replyWindowHours, timeZone })
      : replyRule({ kind: 'comment' });
    const first = thread.entries.find(entry => !entry.fromChannel);
    threadView = <section className={styles.threadPane} aria-label={thread.kind === 'message' ? 'Open conversation' : 'Open comment'}>
      <a className={styles.back} href={query()}>← All conversations</a>
      <header className={styles.threadHead}>
        <h2>{thread.kind === 'message' ? `Conversation with ${first?.author ?? 'a visitor'}` : `Comment by ${thread.entries[0]?.author ?? 'a visitor'}`}</h2>
        <div className={styles.threadTags}>
          <ChannelBadge name={thread.target.name} platformName={badge.platformName} mark={badge.mark} />
          <InboxTag icon={thread.kind === 'message' ? 'message' : 'comment'}>{thread.kind === 'message' ? 'Message' : 'Comment'}</InboxTag>
          {thread.resolved ? <InboxTag icon="resolved" tone="ok">Resolved</InboxTag> : <InboxTag icon="needsReply" tone="warn">Open</InboxTag>}
          {thread.hidden ? <InboxTag icon="hidden">Hidden</InboxTag> : null}
        </div>
      </header>
      {thread.postText ? <p className={styles.postContext}><strong>On your post</strong>{thread.postText.length > 280 ? `${thread.postText.slice(0, 280)}…` : thread.postText}</p> : null}
      <ol className={styles.entries} aria-label="History">
        {thread.entries.map(entry => <li key={entry.id} className={styles.entry} data-from={entry.fromChannel ? 'channel' : 'person'}>
          <div className={styles.entryHead}><strong>{entry.author}</strong>{entry.sentBy ? <span>sent by {entry.sentBy}</span> : null}<time dateTime={entry.time.toISOString()}>{formatInboxTime(entry.time, timeZone, true)}</time></div>
          <p>{entry.text || 'No text in this message.'}</p>
        </li>)}
      </ol>
      {canWrite ? <ThreadToolbar id={thread.id} kind={thread.kind} resolved={thread.resolved} hidden={thread.hidden} canResolve={canWrite} canHide={canWrite && capabilities.hide} canDelete={canWrite && capabilities.remove} platformName={badge.platformName} listHref={query()} /> : null}
      {canWrite && capabilities.reply ? <ReplyBox key={thread.id} id={thread.id} kind={thread.kind} allowed={rule.allowed} headline={rule.headline} detail={rule.detail} />
        : <p className={styles.readOnly}>{canWrite ? 'Replies are not available for this channel.' : 'You can read this conversation, but replying and moderation are unavailable right now. Your role may be read-only, or the channel may need to be reconnected in Connections.'}</p>}
    </section>;
  }

  const sidebar = visibleChannels.length ? <aside className={styles.filters} aria-label="Inbox filters">
    <p className={styles.filterHeading}>Filters</p>
    <form method="get" action="/inbox">
      <label>Channel<select name="channel" defaultValue={selectedChannel}><option value="all">All channels</option>{visibleChannels.map(channel => <option key={channel.id} value={channel.id}>{channel.name}</option>)}</select></label>
      <label>Type<select name="type" defaultValue={kind}><option value="all">All types</option><option value="message">Messages</option><option value="comment">Comments</option></select></label>
      <label>Status<select name="status" defaultValue={status}><option value="open">Open</option><option value="resolved">Resolved</option><option value="all">All</option></select></label>
      <label>Hidden comments<select name="hidden" defaultValue={hidden}><option value="visible">Hide them</option><option value="all">Show them</option></select></label>
      <button className="ui-button ui-button--primary ui-button--md" type="submit">Apply filters</button>
      <a href="/inbox">Reset filters</a>
    </form>
  </aside> : undefined;

  return <PageFrame module="inbox" sidebar={sidebar}><div className={styles.page}>
    <header className={styles.head}>
      <div><p className="eyebrow">Inbox</p><h1>Conversations</h1><p>Messages and comments from the channels you can access.</p></div>
      {visibleChannels.length > 0 && <InboxSyncBar targetId={selectedChannel === 'all' ? undefined : selectedChannel} lastSynced={lastSynced ? formatInboxTime(lastSynced, timeZone, true) : null} timeZone={timeZone} />}
    </header>
    {!visibleChannels.length ? <section className="panel"><div className={styles.empty}>
      <h2>No channels with an inbox yet</h2>
      <p>Messages sent to your channels and comments on your published posts show up here once a channel that supports them is connected and selected.</p>
      <a className="text-link" href="/settings/connections">Go to Connections</a>
    </div></section> : <div className={styles.split} data-open={thread ? 'true' : 'false'}>
      <section className={styles.listPane} aria-label="Conversations and comments">
        <div className={styles.listHead}><h2>{status === 'resolved' ? 'Resolved' : status === 'all' ? 'All activity' : 'Open'}</h2><span>{items.length} {items.length === 1 ? 'item' : 'items'}</span></div>
        {items.length ? <>
          <ul className={styles.list}>{items.map(item => {
            const badge = channelBadgeInfo(item.target.provider);
            const selected = thread !== null && thread.kind === item.kind && thread.id === item.id;
            return <li key={item.key}><a className={styles.item} href={query({ thread: item.key })} aria-current={selected ? 'true' : undefined} data-attention={item.needsReply || item.unread > 0 || undefined}>
              <div className={styles.itemTop}><span className={styles.author}>{item.author}</span><time dateTime={item.time.toISOString()}>{formatInboxTime(item.time, timeZone)}</time></div>
              <p className={styles.preview}>{item.preview.length > 180 ? `${item.preview.slice(0, 180)}…` : item.preview}</p>
              <div className={styles.itemMeta}>
                <ChannelBadge name={item.target.name} platformName={badge.platformName} mark={badge.mark} compact />
                <InboxTag icon={item.kind === 'message' ? 'message' : 'comment'}>{item.kind === 'message' ? 'Message' : 'Comment'}</InboxTag>
                {item.unread > 0 ? <InboxTag icon="unread" tone="warn">{item.unread} unread</InboxTag> : null}
                {item.needsReply ? <InboxTag icon="needsReply" tone="warn">Needs reply</InboxTag> : null}
                {item.resolved ? <InboxTag icon="resolved" tone="ok">Resolved</InboxTag> : null}
                {item.hidden ? <InboxTag icon="hidden">Hidden</InboxTag> : null}
              </div>
            </a></li>;
          })}</ul>
          {truncated && <p className={styles.listNote}>Showing the newest items. Narrow the filters to see older ones.</p>}
        </> : <div className={styles.empty}>
          {filtered ? <><h2>Nothing matches these filters</h2><p>Try another channel, type or status.</p><a className="text-link" href="/inbox">Reset filters</a></>
            : lastSynced ? <><h2>No open conversations</h2><p>New messages and comments appear here after a sync. Resolved conversations are under Status.</p><a className="text-link" href="/inbox?status=resolved">Show resolved</a></>
            : <><h2>Your inbox is empty</h2><p>Messages people send to your channels and comments on your published posts appear here after the first sync. Use Sync now to check for them.</p></>}
        </div>}
      </section>
      {threadView ?? <section className={`${styles.threadPane} ${styles.empty} ${styles.pick}`} aria-label="Open conversation"><h2>Select a conversation</h2><p>Choose a message or comment on the left to read its history and reply.</p></section>}
    </div>}
  </div></PageFrame>;
}
