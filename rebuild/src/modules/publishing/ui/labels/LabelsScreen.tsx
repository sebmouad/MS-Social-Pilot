import { requireViewer } from '@/server/context';
import { readLabelPage } from '@/modules/publishing/server/labels';
import { LABEL_COLORS } from '@/modules/publishing/labels-config';
import { canAccessFeature } from '@/server/permissions';
import { PageHeading } from '@/modules/publishing/ui/publishing-ui';
import { LabelManager } from './LabelManager';
import styles from './labels.module.css';

export default async function LabelsPage({ searchParams }: { searchParams: Promise<{ page?: string; q?: string }> }) {
  const viewer = await requireViewer({ feature: 'publishing/labels', channelScoped: true });
  const params = await searchParams;
  const page = params.page && /^[1-9]\d*$/.test(params.page) ? Number(params.page) : 1;
  const query = typeof params.q === 'string' ? params.q : '';
  const actor = { userId: viewer.user.id, workspaceId: viewer.workspaceId };
  const canWrite = canAccessFeature(viewer.permissions, 'publishing/labels', 'write');
  const result = await readLabelPage(actor, { page, ...(query ? { q: query } : {}) });
  return <>
    <PageHeading title="Labels" description="Tag posts by campaign, client or theme so you can filter and plan content." summary={`${result.pageSize} per page`} />
    <LabelManager initialLabels={result.labels.map(item => ({ ...item, createdAt: item.createdAt.toISOString() }))} colors={[...LABEL_COLORS]} page={result.page} hasMore={result.hasMore} query={result.query} canWrite={canWrite} workspaceWide={result.workspaceWide} maxNameCharacters={result.limits.maxNameCharacters} maxSearchCharacters={result.limits.maxSearchCharacters} />
    <p className={styles.help}>Labels are shared by everyone in your workspace.</p>
  </>;
}
