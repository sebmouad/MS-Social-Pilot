import { requireRootPage } from '@/server/config/access';
import { getRootOverview } from '@/server/root/read-model';
import { RootFrame } from '@/server/root/RootFrame';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Root · Control center' };

export default async function RootOverviewPage() {
  await requireRootPage();
  let data: Awaited<ReturnType<typeof getRootOverview>> | null = null;
  try { data = await getRootOverview(); } catch { /* render an explicit unavailable state below */ }
  return <RootFrame active="/root">
    <header className="root-control__heading"><p className="root-config__eyebrow">Private installation</p><h1>Control center</h1><p>Review installation state and open the tools that need your attention.</p></header>
    {!data ? <section className="root-control__notice" role="alert"><h2>Installation summary unavailable</h2><p>Stored installation counts could not be loaded. Try again later.</p></section> : <>
      <section className="root-control__metrics" aria-label="Installation counts">
        <a href="/root/users"><span>Users</span><strong>{data.users}</strong></a>
        <a href="/root/workspaces"><span>Workspaces</span><strong>{data.workspaces}</strong></a>
        <a href="/root/platforms"><span>Connected sources</span><strong>{data.sources}</strong></a>
        <a href="/root/operations"><span>Published posts</span><strong>{data.publishedPosts}</strong></a>
      </section>
      <section className="root-control__panel" aria-labelledby="root-attention-title">
        <div><h2 id="root-attention-title">Attention</h2><p>Items below come from stored installation state.</p></div>
        <ul className="root-control__attention-list">
          {data.workspaces === 0 && <li>No workspaces have been created. <a href="/root/workspaces">Create a workspace</a>.</li>}
          {data.sources === 0 && <li>No connected sources are recorded. Review <a href="/root/platforms">installed platforms</a> and workspace connections.</li>}
          {data.failedPosts > 0 && <li><strong>{data.failedPosts}</strong> posts are failed or partially failed. Review <a href="/root/activity">recent recorded activity</a>.</li>}
        </ul>
        {data.workspaces > 0 && data.sources > 0 && data.failedPosts === 0 && <p className="root-control__clear">No installation attention items are indicated by the available stored counts.</p>}
        <div className="root-control__links"><a href="/root/operations">Background job health</a><a href="/root/activity">Recent activity</a><a href="/root/config">Runtime configuration</a></div>
      </section>
    </>}
  </RootFrame>;
}
