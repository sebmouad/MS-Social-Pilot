import { PageFrame } from '@/server/PageFrame';
import { requireViewer } from '@/server/context';
import { prisma } from '@/server/data';

export default async function InboxPage() {
  const viewer = await requireViewer();
  const [conversations, comments] = await Promise.all([
    prisma.conversation.findMany({
      where: { target: { workspaceId: viewer.workspaceId } },
      orderBy: { updatedTime: 'desc' },
      take: 50,
      select: {
        id: true,
        snippet: true,
        unreadCount: true,
        updatedTime: true,
        resolvedAt: true,
        target: { select: { id: true, type: true, name: true } },
        messages: {
          orderBy: { createdTime: 'desc' },
          take: 5,
          select: { id: true, fromName: true, message: true, createdTime: true, sentById: true },
        },
      },
    }),
    prisma.postComment.findMany({
      where: {
        isHidden: false,
        postTarget: {
          post: { workspaceId: viewer.workspaceId },
          target: { workspaceId: viewer.workspaceId },
        },
      },
      orderBy: { createdTime: 'desc' },
      take: 50,
      select: {
        id: true,
        message: true,
        fromName: true,
        createdTime: true,
        resolvedAt: true,
        replyCount: true,
        postTarget: {
          select: {
            target: { select: { id: true, type: true, name: true } },
            post: { select: { id: true, message: true } },
          },
        },
      },
    }),
  ]);

  const total = conversations.length + comments.length;
  return <PageFrame module="inbox"><div className="page-stack">
    <header className="page-heading"><div><p className="eyebrow">Inbox</p><h1>Conversations</h1><p>Recent messages and comments across this workspace’s connected channels.</p></div></header>
    {!total ? <section className="panel"><h2>Your inbox is clear</h2><p className="empty-note">New synced Page messages and post comments will appear here.</p><a className="text-link" href="/settings/connections">View connections</a></section> : <>
      <section className="panel"><div className="inbox-summary"><h2>Recent activity</h2><span>{total} items · up to 50 of each type</span></div>
        {conversations.length > 0 && <div className="inbox-group"><h3>Messages <span>{conversations.length}</span></h3><div className="inbox-list">{conversations.map(item => {
          const latest = item.messages[0];
          return <article className="inbox-item" key={`conversation-${item.id}`}>
            <div className="inbox-item-head"><div><strong>{latest?.fromName || 'Conversation'}</strong><span className="inbox-channel">{item.target.name} · {item.target.type}</span></div><time dateTime={item.updatedTime.toISOString()}>{item.updatedTime.toLocaleString()}</time></div>
            <p>{latest?.message || item.snippet || 'No message text available.'}</p>
            <small>{item.unreadCount > 0 ? `${item.unreadCount} unread` : item.resolvedAt ? 'Resolved' : 'Message thread'}</small>
          </article>;
        })}</div></div>}
        {comments.length > 0 && <div className="inbox-group"><h3>Post comments <span>{comments.length}</span></h3><div className="inbox-list">{comments.map(item => <article className="inbox-item" key={`comment-${item.id}`}>
          <div className="inbox-item-head"><div><strong>{item.fromName || 'Visitor'}</strong><span className="inbox-channel">{item.postTarget.target.name} · {item.postTarget.target.type}</span></div><time dateTime={item.createdTime.toISOString()}>{item.createdTime.toLocaleString()}</time></div>
          <p>{item.message}</p>
          <small>{item.resolvedAt ? 'Resolved' : 'Comment'}{item.replyCount ? ` · ${item.replyCount} replies` : ''} · on “{item.postTarget.post.message.slice(0, 100)}{item.postTarget.post.message.length > 100 ? '…' : ''}”</small>
        </article>)}</div></div>}
      </section>
      <style>{`.inbox-summary,.inbox-item-head{display:flex;align-items:flex-start;justify-content:space-between;gap:1rem}.inbox-summary h2{margin:0}.inbox-summary>span,.inbox-item time,.inbox-item small{color:var(--muted,#687386);font-size:.82rem}.inbox-group{margin-top:1.5rem}.inbox-group h3{display:flex;align-items:center;gap:.5rem;margin-bottom:.75rem}.inbox-group h3 span{font-size:.78rem;color:var(--muted,#687386)}.inbox-list{display:grid;gap:.65rem}.inbox-item{border:1px solid var(--border,#e5e7eb);border-radius:12px;padding:1rem}.inbox-item-head>div{display:grid;gap:.2rem}.inbox-channel{font-size:.82rem;color:var(--muted,#687386);text-transform:capitalize}.inbox-item p{margin:.75rem 0;white-space:pre-wrap;overflow-wrap:anywhere}.inbox-item time{white-space:nowrap}`}</style>
    </>}
  </div></PageFrame>;
}
