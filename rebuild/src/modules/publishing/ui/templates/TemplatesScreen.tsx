import { loadPublishingCopy, loadPublishingTemplateCopy } from '../../server/customer-copy';
import { PublishingCopyProvider } from '../kit/CopyProvider';
import { loadPublishingActionCopy } from '../../server/action-copy';
import { PublishingActionCopyProvider } from '../WorkflowSubmitButtons';
import { OperationError } from '@/lib/operation-error';
import { RouteNotice } from '@/components/RouteNotice';
import { requireViewer } from '@/server/context';
import { readTemplateLabels, readTemplatePage } from '@/modules/publishing/server/templates';
import { PageHeading } from '@/modules/publishing/ui/publishing-ui';
import { TemplateManager } from './TemplateManager';
import { pageLocale } from '../kit/locale';
import { canAccessFeature } from '@/server/permissions';
import styles from './templates.module.css';

export default async function TemplatesPage({ searchParams }: { searchParams: Promise<{ page?: string; q?: string }> }) {
  const viewer = await requireViewer({ feature: 'publishing/templates', channelScoped: true });
  const locale = await pageLocale();
  const { catalog, copy: localizedCopy } = await loadPublishingCopy();
  const actionCatalog = await loadPublishingActionCopy();
  const managerCatalog = await loadPublishingTemplateCopy();
  const copy = localizedCopy[locale];
  const params = await searchParams;
  if (Object.entries(params).some(([key, value]) => !['page', 'q'].includes(key) || typeof value !== 'string') || (params.page && !/^[1-9]\d*$/.test(params.page))) return <><PageHeading title={copy.templatesTitle} description={copy.templateFilters} /><RouteNotice error focusKey="template-load-error">{copy.templateInvalid}</RouteNotice></>;
  const page = params.page ? Number(params.page) : 1;
  const query = params.q ?? '';
  const actor = { userId: viewer.user.id, workspaceId: viewer.workspaceId };
  const canWrite = canAccessFeature(viewer.permissions, 'publishing/templates', 'write');
  let result, labels;
  try { [result, labels] = await Promise.all([
    readTemplatePage(actor, { page, ...(query ? { q: query } : {}) }),
    readTemplateLabels(actor),
  ]); } catch (error) { return <><PageHeading title={copy.templatesTitle} description={copy.templatesDescription} /><RouteNotice error focusKey="template-load-error">{error instanceof OperationError ? error.message : copy.templateLoadError}</RouteNotice></>; }
  return <PublishingCopyProvider catalog={catalog} locale={locale}><PublishingActionCopyProvider catalog={actionCatalog} locale={locale}>
    <PageHeading href="/publishing/templates" title={copy.templatesTitle} description={copy.templatesDescription} summary={copy.perPage(result.pageSize)} />
    <TemplateManager catalog={managerCatalog} initialTemplates={result.templates.map(item => ({ ...item, createdAt: item.createdAt.toISOString(), updatedAt: item.updatedAt.toISOString() }))} labels={labels} page={result.page} hasMore={result.hasMore} query={result.query} canWrite={canWrite} limits={result.limits} locale={locale} />
    <p className={styles.privacy}>{copy.templatesPrivate}</p>
  </PublishingActionCopyProvider></PublishingCopyProvider>;
}
