import { PageFrame } from '@/server/PageFrame';
import { requireViewer } from '@/server/context';
import { getTargets } from '@/server/data';

export default async function InboxPage() {
  const viewer = await requireViewer();
  const targets = await getTargets(viewer.workspaceId);
  return <PageFrame module="inbox"><div className="page-stack">
    <header className="page-heading"><div><p className="eyebrow">Inbox</p><h1>Conversations</h1><p>Messages and comments across connected channels.</p></div></header>
    <section className="panel"><h2>Channel coverage</h2><p className="empty-note">{targets.length ? `${targets.length} channels are connected. Conversation sync is not available in this preview yet.` : 'Connect a channel to bring its conversations into your workspace.'}</p>{!targets.length && <a className="text-link" href="/settings/connections">View connections</a>}</section>
  </div></PageFrame>;
}
