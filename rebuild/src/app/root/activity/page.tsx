import { requireRootPage } from '@/server/config/access';
import { runtimeConfig } from '@/server/config/store';
import { RootFrame } from '@/server/root/RootFrame';
import { listRootActivity } from '@/server/root/read-model';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Activity · Root' };

export default async function RootActivityPage({ searchParams }: { searchParams: Promise<{ limit?: string }> }) {
  await requireRootPage();
  const params = await searchParams;
  let activities: Awaited<ReturnType<typeof listRootActivity>> | null = null;
  try { activities = await listRootActivity(params.limit, await runtimeConfig('root.activityPageSize')); } catch { /* display a deliberate read failure */ }
  return <RootFrame active="/root/activity">
    <header className="root-control__heading"><p className="root-config__eyebrow">Root · Control center</p><h1>Activity</h1><p>Recent recorded changes across this installation. Sensitive audit details are intentionally omitted.</p></header>
    {activities === null ? <section className="root-control__notice" role="alert"><h2>Activity is unavailable</h2><p>The audit store could not be read. Retry the page after checking database availability.</p></section> : activities.length === 0 ? <section className="root-control__panel"><h2>No activity recorded</h2><p>Installation and workspace actions will appear here when they are recorded.</p></section> : <ol className="root-activity">
      {activities.map(item => <li key={item.id}>
        <div className="root-activity__heading"><h2>{item.action.replaceAll('.', ' · ').replaceAll('_', ' ')}</h2><time dateTime={item.createdAt.toISOString()}>{item.createdAt.toLocaleString()}</time></div>
        <p className="root-activity__actor">{item.actor ? `${item.actor.name} · ${item.actor.email}` : 'System or deleted account'}</p>
        {item.metadata.length > 0 && <ul aria-label="Safe activity details">{item.metadata.map(value => <li key={value}>{value}</li>)}</ul>}
      </li>)}
    </ol>}
  </RootFrame>;
}
