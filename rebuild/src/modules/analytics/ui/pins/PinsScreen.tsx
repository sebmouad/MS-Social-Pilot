import { PageHeader } from '@/components/PageHeader';
import { PageFrame } from '@/server/PageFrame';
import { requireViewer } from '@/server/context';
import { operationFailure } from '@/lib/operation-error';
import { readPinnedMetrics } from '@/modules/analytics/pins/server/pins';
import { pinnedSearchSchema } from './search';
import { WorkflowNav } from '@/modules/analytics/ui/reports/WorkflowNav';
import { formatValue, formatWhen } from '@/modules/analytics/ui/reports/format';
import styles from '@/modules/analytics/ui/reports/workflows.module.css';
import { PinManager } from './PinManager';

type Search = Record<string, string | string[] | undefined>;
const CHANGE = (c: { status: string; delta: number | null; percent: number | null } | null, unit: string) =>
  c && c.status === 'comparable' && c.delta !== null ? `${c.delta > 0 ? '+' : ''}${formatValue(c.delta, unit)}${c.percent === null ? '' : ` (${c.percent > 0 ? '+' : ''}${c.percent.toFixed(1)}%)`} vs previous period` : '';

export default async function PinnedPage({ searchParams }: { searchParams: Promise<Search> }) {
  const viewer = await requireViewer({ feature: 'analytics/pins', channelScoped: true });
  const params = await searchParams; let failure = ''; let data: Awaited<ReturnType<typeof readPinnedMetrics>> | null = null;
  const parsed = pinnedSearchSchema.safeParse(params);
  try {
    if (!parsed.success) throw new Error('Choose valid date filters and try again.');
    data = await readPinnedMetrics({ userId: viewer.user.id, workspaceId: viewer.workspaceId }, { ...parsed.data, compare: 'previous' });
  }
  catch (error) { failure = operationFailure(error, 'Pinned metrics could not be loaded. Please try again.').error; }
  return <PageFrame module="analytics" scopedAccess sidebar={<WorkflowNav current="/analytics/pins" />}><div className={styles.root}>
    <PageHeader module="analytics" title={"Pinned metrics"} description={<>Keep the measures you watch most in one place. Pins are personal; values come from stored analytics for the resources you can access.</>} />
    {failure && <section className={styles.panel} role="alert"><h2>Pinned metrics could not be loaded</h2><p>{failure}</p><a href="/analytics/pins">Try again</a></section>}
    {data && <PinManager max={data.max} pinnable={data.pinnable} pins={data.pins.map(p => ({
      key: p.key, label: p.label, sourceLabel: p.sourceLabel, state: p.state, value: formatValue(p.total, p.unit, p.displayTotal),
      coverage: p.available === null ? '' : `${p.coverage ?? 0} of ${p.available} ${p.resourceKind === 'ad-account' ? 'ad accounts' : 'channels'} reported`, asOf: formatWhen(p.latestAt),
      basis: p.aggregationLabel ?? '', change: CHANGE(p.comparison, p.unit) }))} />}
  </div></PageFrame>;
}
