import { requireRootPage } from '@/server/config/access';
import { runtimeConfig } from '@/server/config/store';
import { RootFrame } from '@/server/root/RootFrame';
import { listRootActivity } from '@/server/root/activity';
import { RootActivityFilters } from '@/server/root/RootActivityFilters';
import { rootActivitySearchParams, type RootActivitySearch } from '@/lib/root-activity';
import { OperationError } from '@/lib/operation-error';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Activity · Root' };

export default async function RootActivityPage({ searchParams }: { searchParams: Promise<RootActivitySearch> }) {
  const actor = await requireRootPage();
  const params = await searchParams;
  let activities: Awaited<ReturnType<typeof listRootActivity>> | null = null;
  let policy: { pageSize: number; searchCharacters: number } | null = null;
  let invalid = false;
  try {
    const [pageSize, searchCharacters] = await Promise.all([runtimeConfig('root.activityPageSize'), runtimeConfig('root.activitySearchMaxCharacters')]);
    policy = { pageSize, searchCharacters };
    activities = await listRootActivity(actor.id, rootActivitySearchParams(params));
  } catch (error) { invalid = error instanceof OperationError && error.code === 'invalid_request'; }
  const filtered = Boolean(activities && Object.values(activities.filters).some(Boolean));
  return <RootFrame active="/root/activity">
    <header className="root-control__heading"><p className="root-config__eyebrow">Root · Control center</p><h1>Activity</h1><p>Recorded changes across this installation. Dates and times use UTC. Sensitive audit details are omitted.</p></header>
    <RootActivityFilters values={params} page={activities} policy={policy} />
    {activities === null ? <section className="root-control__notice" role="alert"><h2>{invalid ? 'Check activity filters' : 'Activity is unavailable'}</h2><p>{invalid ? 'A date, search or page link is invalid. Adjust the sidebar filters or reset to the latest activity.' : 'The audit store could not be read. Please retry, or check database availability.'}</p><a href="/root/activity">Reset to latest activity</a></section> : activities.items.length === 0 ? <section className="root-control__panel"><h2>{params.cursor ? 'No activity on this page' : filtered ? 'No activity matches these filters' : 'No activity recorded'}</h2><p>{params.cursor ? 'Recorded events may have changed. Open the latest matching activity from the sidebar.' : filtered ? 'Try another action, person, workspace or date range.' : 'Installation and workspace actions will appear here when recorded.'}</p></section> : <><p className="root-activity__summary">Showing {activities.items.length} {filtered ? 'matching ' : ''}recorded {activities.items.length === 1 ? 'event' : 'events'}.</p><ol className="root-activity">
      {activities.items.map(item => <li key={item.id}>
        <div className="root-activity__heading"><h2>{item.action.replaceAll('.', ' · ').replaceAll('_', ' ')}</h2><time dateTime={item.createdAt.toISOString()}>{item.createdAt.toISOString().replace('T', ' ').replace('.000Z', ' UTC').replace(/Z$/, ' UTC')}</time></div>
        <p className="root-activity__actor">{item.actor ? `${item.actor.name} · ${item.actor.email}` : 'System or deleted account'}</p>
        {item.metadata.length > 0 && <ul aria-label="Safe activity details">{item.metadata.map(value => <li key={value}>{value}</li>)}</ul>}
      </li>)}
    </ol></>}
  </RootFrame>;
}
