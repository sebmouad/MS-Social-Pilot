import { ComposerCopyProvider } from '@/modules/publishing/ui/compose/CopyProvider';
import { headers } from 'next/headers';
import { loadComposerCopy } from '../../server/composer-copy';
import { catalogGroup } from '../../composer-catalog';
import { PublishingCopyProvider } from '@/modules/publishing/ui/kit/CopyProvider';
import { loadPublishingCopy } from '@/modules/publishing/server/customer-copy';
import { PublishingActionCopyProvider } from '@/modules/publishing/ui/WorkflowSubmitButtons';
import { loadPublishingActionCopy } from '@/modules/publishing/server/action-copy';
import { ensurePublishingCollaboration } from '@/modules/publishing/server/collaboration';
import { runtimeConfig } from '@/server/config/store';
import { parseCollaborationSearch } from '@/modules/publishing/collaboration/search';
import { OperationError } from '@/lib/operation-error';
import { RouteNotice } from '@/components/RouteNotice';
import { requireViewer } from '@/server/context';
import { canUseFeature } from '@/server/entitlements';
import { canAccessFeature } from '@/server/permissions';
import { bounds } from '@/modules/publishing/collaboration/server/core';
import { readCustomFields } from '@/modules/publishing/collaboration/server/custom-fields';
import { listAssignablePosts } from '@/modules/publishing/collaboration/server/post-list';
import { readCollaborationLabels } from '@/modules/publishing/collaboration/server/label-choices';
import { LibraryHeader } from '../library/LibraryHeader';
import { redirect } from 'next/navigation';
import { BulkLabels } from './BulkLabels';
import { CollaborationNav, type ViewId } from './CollaborationNav';
import { FieldsManager } from './FieldsManager';


async function CollaborationPageContent({ searchParams }: { searchParams: Promise<{ view?: string; page?: string; q?: string }> }) {
  ensurePublishingCollaboration();
  const locale = /^\s*fr\b/i.test((await headers()).get('accept-language') ?? '') ? 'fr' : 'en';
  const copy = catalogGroup(await loadComposerCopy(), 'collab', locale);
  const params = await searchParams;
  // Queue times and the content mix moved to Content › Queue; an old address lands there.
  if (params.view === 'queue' || params.view === 'mix') redirect('/content/queue');
  // Library › Fields keeps the two views that belong to the library: bulk label assignment and custom fields.
  const available: ViewId[] = ['assign', 'fields'];
  const view: ViewId = available.includes(params.view as ViewId) ? (params.view as ViewId) : 'fields';
  const feature = 'publishing/collaboration';
  const viewer = await requireViewer({ feature, channelScoped: true });
  const visibleViews = available.filter(() => canUseFeature(viewer.entitlements, feature) && canAccessFeature(viewer.permissions, feature, 'read'));
  const actor = { userId: viewer.user.id, workspaceId: viewer.workspaceId };
  const canWrite = canAccessFeature(viewer.permissions, feature, 'write');
  const header = <LibraryHeader active="fields" viewer={viewer} />;
  const failure = (error: unknown) => <>{header}<RouteNotice error focusKey="collab-load-error">{error instanceof OperationError ? error.message : copy.loadFailure}</RouteNotice></>;
  try {
    const maxCharacters = await runtimeConfig('publishing.searchMaxCharacters');
    const filters = parseCollaborationSearch(params, visibleViews, maxCharacters);
    const nav = <CollaborationNav view={view} available={visibleViews} />;
    if (view === 'assign') {
      const { page, q } = filters;
      const [result, labels] = await Promise.all([listAssignablePosts(actor, { page, ...(q ? { q } : {}) }), readCollaborationLabels(actor)]);
      return <>{header}{nav}
        <BulkLabels initialPosts={result.posts.map(p => ({ ...p, scheduledAt: p.scheduledAt?.toISOString() ?? null }))} labels={labels.labels.map(({ id, name, color }) => ({ id, name, color }))} page={result.page} hasMore={result.hasMore} query={result.query} canWrite={canWrite} bulkLimit={result.bulkLimit} labelsPerPost={result.labelsPerPostLimit} searchMaxCharacters={maxCharacters} /></>;
    }
    const [fields, limit] = await Promise.all([readCustomFields(actor), bounds()]);
    const canManage = canWrite && (viewer.membership.role === 'owner' || viewer.membership.role === 'admin') && viewer.permissions.pageScope.all;
    return <>{header}{nav}
      <FieldsManager initialFields={fields} canManage={canManage} limits={{ fieldLimit: limit.fieldLimit, nameMax: limit.fieldNameMax, optionMax: limit.fieldOptionMax, optionsMax: limit.fieldOptionsLimit }} /></>;
  } catch (error) { return failure(error); }
}

export default async function CollaborationPage(props: Parameters<typeof CollaborationPageContent>[0]) {
  const [{ catalog }, actions, composerCatalog] = await Promise.all([loadPublishingCopy(), loadPublishingActionCopy(), loadComposerCopy()]);
  const locale = /^\s*fr\b/i.test((await headers()).get('accept-language') ?? '') ? 'fr' : 'en';
  return <PublishingCopyProvider catalog={catalog}><PublishingActionCopyProvider catalog={actions} locale={locale}><ComposerCopyProvider catalog={composerCatalog} locale={locale}>{await CollaborationPageContent(props)}</ComposerCopyProvider></PublishingActionCopyProvider></PublishingCopyProvider>;
}
