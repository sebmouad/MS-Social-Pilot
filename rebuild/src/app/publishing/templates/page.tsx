import { OperationError } from '@/lib/operation-error';
import { RouteNotice } from '@/components/RouteNotice';
import { requireViewer } from '@/server/context';
import { readTemplateLabels, readTemplatePage } from '@/modules/publishing/server/templates';
import { PageHeading } from '../publishing-ui';
import { TemplateManager } from './TemplateManager';
import { canAccessFeature } from '@/server/permissions';
import styles from './templates.module.css';

export default async function TemplatesPage({ searchParams }: { searchParams: Promise<{ page?: string; q?: string }> }) {
  const viewer = await requireViewer({ feature: 'publishing/templates', channelScoped: true });
  const params = await searchParams;
  if (Object.entries(params).some(([key, value]) => !['page', 'q'].includes(key) || typeof value !== 'string') || (params.page && !/^[1-9]\d*$/.test(params.page))) return <><PageHeading title="Templates" description="Review your template filters." /><RouteNotice error focusKey="template-load-error">Choose valid template filters and try again.</RouteNotice></>;
  const page = params.page ? Number(params.page) : 1;
  const query = params.q ?? '';
  const actor = { userId: viewer.user.id, workspaceId: viewer.workspaceId };
  const canWrite = canAccessFeature(viewer.permissions, 'publishing/templates', 'write');
  let result, labels;
  try { [result, labels] = await Promise.all([
    readTemplatePage(actor, { page, ...(query ? { q: query } : {}) }),
    readTemplateLabels(actor),
  ]); } catch (error) { return <><PageHeading title="Templates" description="Save reusable post content for your workspace." /><RouteNotice error focusKey="template-load-error">{error instanceof OperationError ? error.message : 'Templates could not be loaded. Refresh and try again.'}</RouteNotice></>; }
  return <>
    <PageHeading title="Templates" description="Save reusable post messages, hashtags and first comments for your workspace." summary={`${result.pageSize} per page`} />
    <TemplateManager initialTemplates={result.templates.map(item => ({ ...item, createdAt: item.createdAt.toISOString(), updatedAt: item.updatedAt.toISOString() }))} labels={labels} page={result.page} hasMore={result.hasMore} query={result.query} canWrite={canWrite} limits={result.limits} />
    <p className={styles.privacy}>Templates are private to your workspace. Channel media and links are selected when composing a post.</p>
  </>;
}
