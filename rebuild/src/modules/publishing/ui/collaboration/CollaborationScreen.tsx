import { ComposerCopyProvider } from '@/modules/publishing/ui/compose/CopyProvider';
import { headers } from 'next/headers';
import { loadComposerCopy } from '../../server/composer-copy';
import { catalogGroup } from '../../composer-catalog';
import { PublishingCopyProvider } from '@/modules/publishing/ui/kit/CopyProvider';
import { loadPublishingCopy } from '@/modules/publishing/server/customer-copy';
import { PublishingActionCopyProvider } from '@/modules/publishing/ui/WorkflowSubmitButtons';
import { loadPublishingActionCopy } from '@/modules/publishing/server/action-copy';
import { queueDefaultSlotSchema } from '@/modules/publishing/queue-config';
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
import { readContentMix } from '@/modules/publishing/collaboration/server/content-mix';
import { readQueueSlots } from '@/modules/publishing/collaboration/server/queue-slots';
import { readCollaborationLabels } from '@/modules/publishing/collaboration/server/label-choices';
import { collaborationCapabilities } from '@/modules/publishing/collaboration/ports';
import { PageHeading } from '@/modules/publishing/ui/publishing-ui';
import { BulkLabels } from './BulkLabels';
import { CollaborationNav, type ViewId } from './CollaborationNav';
import { ContentMix } from './ContentMix';
import { FieldsManager } from './FieldsManager';
import { QueueTimes } from './QueueTimes';


async function CollaborationPageContent({ searchParams }: { searchParams: Promise<{ view?: string; page?: string; q?: string }> }) {
  ensurePublishingCollaboration();
  const locale = /^\s*fr\b/i.test((await headers()).get('accept-language') ?? '') ? 'fr' : 'en';
  const copy = catalogGroup(await loadComposerCopy(), 'collab', locale);
  const TITLES: Record<ViewId, string> = { assign: copy.assign, fields: copy.fields, queue: copy.queue, mix: copy.mix };
  const params = await searchParams;
  const caps = collaborationCapabilities();
  const available: ViewId[] = ['assign', 'fields', ...(caps.queueTimes ? ['queue' as const] : []), ...(caps.contentMix ? ['mix' as const] : [])];
  const view: ViewId = available.includes(params.view as ViewId) ? (params.view as ViewId) : 'assign';
  const feature = view === 'queue' || view === 'mix' ? 'publishing/queue' : 'publishing/collaboration';
  const viewer = await requireViewer({ feature, channelScoped: true });
  const visibleViews = available.filter(candidate => {
    const candidateFeature = candidate === 'queue' || candidate === 'mix' ? 'publishing/queue' : 'publishing/collaboration';
    return canUseFeature(viewer.entitlements, candidateFeature) && canAccessFeature(viewer.permissions, candidateFeature, 'read');
  });
  const actor = { userId: viewer.user.id, workspaceId: viewer.workspaceId };
  const canWrite = canAccessFeature(viewer.permissions, feature, 'write');
  const failure = (error: unknown) => <><PageHeading title={TITLES[view]} description={copy.intro} /><RouteNotice error focusKey="collab-load-error">{error instanceof OperationError ? error.message : copy.loadFailure}</RouteNotice></>;
  try {
    const maxCharacters = await runtimeConfig('publishing.searchMaxCharacters');
    const filters = parseCollaborationSearch(params, visibleViews, maxCharacters);
    const nav = <CollaborationNav view={view} available={visibleViews} />;
    if (view === 'assign') {
      const { page, q } = filters;
      const [result, labels] = await Promise.all([listAssignablePosts(actor, { page, ...(q ? { q } : {}) }), readCollaborationLabels(actor)]);
      return <>{nav}<PageHeading title={copy.assign} description={copy.assignHelp} />
        <BulkLabels initialPosts={result.posts.map(p => ({ ...p, scheduledAt: p.scheduledAt?.toISOString() ?? null }))} labels={labels.labels.map(({ id, name, color }) => ({ id, name, color }))} page={result.page} hasMore={result.hasMore} query={result.query} canWrite={canWrite} bulkLimit={result.bulkLimit} labelsPerPost={result.labelsPerPostLimit} searchMaxCharacters={maxCharacters} /></>;
    }
    if (view === 'fields') {
      const [fields, limit] = await Promise.all([readCustomFields(actor), bounds()]);
      const canManage = canWrite && (viewer.membership.role === 'owner' || viewer.membership.role === 'admin') && viewer.permissions.pageScope.all;
      return <>{nav}<PageHeading title={copy.fields} description={copy.fieldsHelp} />
        <FieldsManager initialFields={fields} canManage={canManage} limits={{ fieldLimit: limit.fieldLimit, nameMax: limit.fieldNameMax, optionMax: limit.fieldOptionMax, optionsMax: limit.fieldOptionsLimit }} /></>;
    }
    if (view === 'queue') {
      const [result, limit] = await Promise.all([readQueueSlots(actor), bounds()]);
      return <>{nav}<PageHeading title={copy.queue} description={copy.queueHelp} />
        <QueueTimes initialSlot={queueDefaultSlotSchema.parse(await runtimeConfig('publishing.queue.defaultSlot'))} timeZone={viewer.membership.workspace.timezone} slots={result.slots} targets={result.targets.map(({ id, name }) => ({ id, name }))} canEditShared={result.canEditShared} canEditChannels={result.canEditChannels} limit={limit.queueSlotLimit} /></>;
    }
    const mix = await readContentMix(actor);
    return <>{nav}<PageHeading title={copy.mix} description={copy.mixHelp} />
      <ContentMix targets={mix.targets.map(({ id, name }) => ({ id, name }))} groups={mix.groups} labels={mix.labels.map(({ id, name }) => ({ id, name }))} rules={mix.rules} status={mix.status} windowDays={mix.windowDays} maxPerWeek={mix.maxPerWeek} mixAutoFill={mix.mixAutoFill} canEditChannels={mix.canEditChannels} canEditGroups={mix.canEditGroups} canEditAutoFill={mix.canEditAutoFill} /></>;
  } catch (error) { return failure(error); }
}

export default async function CollaborationPage(props: Parameters<typeof CollaborationPageContent>[0]) {
  const [{ catalog }, actions, composerCatalog] = await Promise.all([loadPublishingCopy(), loadPublishingActionCopy(), loadComposerCopy()]);
  const locale = /^\s*fr\b/i.test((await headers()).get('accept-language') ?? '') ? 'fr' : 'en';
  return <PublishingCopyProvider catalog={catalog}><PublishingActionCopyProvider catalog={actions} locale={locale}><ComposerCopyProvider catalog={composerCatalog} locale={locale}>{await CollaborationPageContent(props)}</ComposerCopyProvider></PublishingActionCopyProvider></PublishingCopyProvider>;
}
