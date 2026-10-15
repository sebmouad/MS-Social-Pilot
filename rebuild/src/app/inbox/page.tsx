import { PageFrame } from '@/server/PageFrame';
import { requireViewer } from '@/server/context';
import { prisma } from '@/server/data';
import { canAccessPage } from '@/server/permissions';
import { canManageFacebookInbox } from '@/server/inbox/actions';
import { runtimeConfig } from '@/server/config/store';
import { messengerReplyWindow } from '@/server/inbox/reply-window';
import { InboxActions, InboxSyncButton } from './InboxActions';

type SearchParams = { channel?: string; type?: string; status?: string; hidden?: string };
const valid = (value: string | undefined, choices: readonly string[], fallback: string) => value && choices.includes(value) ? value : fallback;

export default async function InboxPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const viewer = await requireViewer({ feature: 'inbox/conversations' });
  const params = await searchParams;
  const kind = valid(params.type, ['all', 'message', 'comment'], 'all');
  const status = valid(params.status, ['open', 'resolved', 'all'], 'open');
  const hiddenFilter = valid(params.hidden, ['visible', 'all'], 'visible');
  const channels = await prisma.target.findMany({
    where: { workspaceId: viewer.workspaceId, type: 'page', enabled: true, socialAccount: { is: { provider: 'facebook', invalidatedAt: null } } },
    orderBy: { name: 'asc' }, select: { id: true, name: true },
  });
  const visibleChannels = channels.filter(channel => canAccessPage(viewer.permissions, channel.id));
  const selectedChannel = visibleChannels.some(channel => channel.id === params.channel) ? params.channel! : 'all';
  const channelIds = selectedChannel === 'all' ? visibleChannels.map(channel => channel.id) : [selectedChannel];
  const [conversations, comments, replyWindowHours] = await Promise.all([
    kind === 'comment' || !channelIds.length ? Promise.resolve([]) : prisma.conversation.findMany({
      where: { targetId: { in: channelIds }, target: { workspaceId: viewer.workspaceId }, ...(status === 'open' ? { resolvedAt: null } : status === 'resolved' ? { resolvedAt: { not: null } } : {}) },
      orderBy: { updatedTime: 'desc' }, take: 50,
      select: { id: true, snippet: true, unreadCount: true, updatedTime: true, resolvedAt: true, target: { select: { id: true, type: true, name: true, providerId: true } }, messages: { orderBy: { createdTime: 'desc' }, take: 25, select: { id: true, fromName: true, fromId: true, message: true, createdTime: true, sentById: true } } },
    }),
    kind === 'message' || !channelIds.length ? Promise.resolve([]) : prisma.postComment.findMany({
      where: { ...(hiddenFilter === 'visible' ? { isHidden: false } : {}), postTarget: { targetId: { in: channelIds }, post: { workspaceId: viewer.workspaceId }, target: { workspaceId: viewer.workspaceId } }, ...(status === 'open' ? { resolvedAt: null } : status === 'resolved' ? { resolvedAt: { not: null } } : {}) },
      orderBy: { createdTime: 'desc' }, take: 50,
      select: { id: true, message: true, fromName: true, createdTime: true, resolvedAt: true, replyCount: true, isHidden: true, postTarget: { select: { target: { select: { id: true, type: true, name: true } }, post: { select: { id: true, message: true } } } } },
    }),
    runtimeConfig('inbox.messengerReplyWindowHours') as Promise<number>,
  ]);
  // The preview keeps a short message history. Query the actual latest visitor
  // message separately so a busy thread cannot incorrectly close its reply UI.
  const lastInbound = new Map(await Promise.all(conversations.map(async item => [item.id, await prisma.conversationMessage.findFirst({
    where: { conversationId: item.id, fromId: { not: null }, NOT: { fromId: item.target.providerId } },
    orderBy: { createdTime: 'desc' }, select: { fromId: true, createdTime: true },
  })] as const)));
  const writeMap = new Map(await Promise.all([...new Set([...conversations.map(item => item.target.id), ...comments.map(item => item.postTarget.target.id)])].map(async targetId => [targetId, await canManageFacebookInbox({ userId: viewer.user.id, workspaceId: viewer.workspaceId }, targetId)] as const)));
  const total = conversations.length + comments.length;
  const sidebar = <aside className="inbox-filters"><h2>Filter inbox</h2><form method="get" action="/inbox">
    <label>Channel<select name="channel" defaultValue={selectedChannel}><option value="all">All channels</option>{visibleChannels.map(channel => <option key={channel.id} value={channel.id}>{channel.name}</option>)}</select></label>
    <label>Activity<select name="type" defaultValue={kind}><option value="all">Messages and comments</option><option value="message">Messages</option><option value="comment">Comments</option></select></label>
    <label>Status<select name="status" defaultValue={status}><option value="open">Open</option><option value="resolved">Resolved</option><option value="all">All</option></select></label>
    <label>Comments<select name="hidden" defaultValue={hiddenFilter}><option value="visible">Visible only</option><option value="all">Include hidden</option></select></label>
    <button type="submit">Apply filters</button><a href="/inbox">Clear filters</a>
  </form></aside>;

  return <PageFrame module="inbox" sidebar={sidebar}><div className="page-stack inbox-page">
    <header className="page-heading inbox-page-heading"><div><p className="eyebrow">Inbox</p><h1>Conversations</h1><p>Page messages and post comments from the Facebook channels you can access.</p></div><InboxSyncButton targetId={selectedChannel === 'all' ? undefined : selectedChannel} disabled={!visibleChannels.length} /></header>
    {!total ? <section className="panel"><h2>{visibleChannels.length ? 'No inbox activity matches these filters' : 'No Facebook Pages are available'}</h2><p className="empty-note">Sync connected Facebook Pages to load conversations and comments on posts published through this app. Comments on posts made elsewhere are not synced yet.</p><a className="text-link" href="/settings/connections">View connections</a></section> : <section className="panel">
      <div className="inbox-summary"><h2>Recent activity</h2><span>{total} items · up to 50 per type</span></div>
      {conversations.length > 0 && <div className="inbox-group"><h3>Messages <span>{conversations.length}</span></h3><div className="inbox-list">{conversations.map(item => {
        const latest = item.messages[0];
        const inbound = lastInbound.get(item.id);
        const replyWindow = messengerReplyWindow({ messages: inbound ? [inbound] : [], pageId: item.target.providerId, windowHours: replyWindowHours });
        return <article className="inbox-item" key={`conversation-${item.id}`}>
          <div className="inbox-item-head"><div><strong>{latest?.fromName || 'Conversation'}</strong><span className="inbox-channel">{item.target.name} · {item.target.type}</span></div><time dateTime={item.updatedTime.toISOString()}>{item.updatedTime.toLocaleString()}</time></div>
          <p>{latest?.message || item.snippet || 'No message text available.'}</p><small>{item.unreadCount > 0 ? `${item.unreadCount} unread` : item.resolvedAt ? 'Resolved' : 'Message thread'}</small>
          <InboxActions id={item.id} kind="message" resolved={Boolean(item.resolvedAt)} canWrite={writeMap.get(item.target.id) === true} replyWindow={replyWindow.state} replyUntil={replyWindow.state === 'open' ? replyWindow.until.toLocaleString() : undefined} replyWindowHours={replyWindowHours} />
        </article>;
      })}</div></div>}
      {comments.length > 0 && <div className="inbox-group"><h3>Post comments <span>{comments.length}</span></h3><div className="inbox-list">{comments.map(item => <article className="inbox-item" key={`comment-${item.id}`}>
        <div className="inbox-item-head"><div><strong>{item.fromName || 'Visitor'}</strong><span className="inbox-channel">{item.postTarget.target.name} · {item.postTarget.target.type}</span></div><time dateTime={item.createdTime.toISOString()}>{item.createdTime.toLocaleString()}</time></div>
        <p>{item.message}</p><small>{item.isHidden ? 'Hidden' : 'Visible'} · {item.resolvedAt ? 'Resolved' : 'Comment'}{item.replyCount ? ` · ${item.replyCount} replies` : ''} · on “{item.postTarget.post.message.slice(0, 100)}{item.postTarget.post.message.length > 100 ? '…' : ''}”</small>
        <InboxActions id={item.id} kind="comment" resolved={Boolean(item.resolvedAt)} hidden={item.isHidden} canWrite={writeMap.get(item.postTarget.target.id) === true} replyWindowHours={replyWindowHours} />
      </article>)}</div></div>}
    </section>}
    <style>{`.inbox-page-heading{display:flex;justify-content:space-between;gap:1rem;align-items:flex-start}.inbox-summary,.inbox-item-head{display:flex;align-items:flex-start;justify-content:space-between;gap:1rem}.inbox-summary h2{margin:0}.inbox-summary>span,.inbox-item time,.inbox-item small{color:var(--ink-soft);font-size:.82rem}.inbox-group{margin-top:1.5rem}.inbox-group h3{display:flex;align-items:center;gap:.5rem;margin-bottom:.75rem}.inbox-group h3 span{font-size:.78rem;color:var(--ink-soft)}.inbox-list{display:grid;gap:.65rem}.inbox-item{border:1px solid var(--line);border-radius:12px;padding:1rem}.inbox-item-head>div{display:grid;gap:.2rem}.inbox-channel{font-size:.82rem;color:var(--ink-soft);text-transform:capitalize}.inbox-item p{margin:.75rem 0;white-space:pre-wrap;overflow-wrap:anywhere}.inbox-item time{white-space:nowrap}.inbox-filters h2{font-size:1rem}.inbox-filters form,.inbox-filters label{display:grid;gap:.45rem}.inbox-filters form{gap:.8rem}.inbox-filters select,.inbox-filters button{font:inherit;padding:.5rem;border:1px solid var(--line);border-radius:8px;background:var(--surface)}.inbox-filters a{font-size:.85rem}.inbox-actions{display:grid;gap:.5rem;margin-top:.8rem}.inbox-actions>form{display:flex;align-items:flex-end;gap:.5rem}.inbox-actions textarea{width:min(100%,38rem);resize:vertical;font:inherit;padding:.6rem;border:1px solid var(--line-strong);border-radius:8px;background:var(--surface);color:var(--ink)}.inbox-actions textarea:disabled{opacity:.65;cursor:not-allowed}.inbox-actions button,.inbox-sync-control button{font:inherit;padding:.5rem .75rem;border:1px solid var(--line-strong);border-radius:8px;background:var(--surface);color:var(--ink);cursor:pointer}.inbox-actions button:disabled,.inbox-sync-control button:disabled{opacity:.55;cursor:wait}.inbox-window-open{color:var(--accent)}.inbox-window-closed{color:var(--danger)}.inbox-action-buttons{display:flex;gap:.5rem}.inbox-error{margin:0;color:var(--danger);font-size:.86rem}.inbox-read-only{color:var(--ink-soft)}.inbox-sync-control{display:grid;justify-items:end;gap:.35rem}.inbox-sync-control span{max-width:24rem;font-size:.8rem;color:var(--ink-soft)}@media(max-width:650px){.inbox-page-heading,.inbox-item-head{flex-direction:column}.inbox-actions>form{align-items:stretch;flex-direction:column}.inbox-actions textarea{width:100%}}`}</style>
  </div></PageFrame>;
}
