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

const TITLES: Record<ViewId, string> = { assign: 'Labels on posts', fields: 'Custom fields', queue: 'Queue times', mix: 'Content mix' };

export default async function CollaborationPage({ searchParams }: { searchParams: Promise<{ view?: string; page?: string; q?: string }> }) {
  ensurePublishingCollaboration();
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
  const failure = (error: unknown) => <><PageHeading title={TITLES[view]} description="Organize posts for your team." /><RouteNotice error focusKey="collab-load-error">{error instanceof OperationError ? error.message : 'This page could not be loaded. Refresh and try again.'}</RouteNotice></>;
  try {
    const maxCharacters = await runtimeConfig('publishing.searchMaxCharacters');
    const filters = parseCollaborationSearch(params, visibleViews, maxCharacters);
    const nav = <CollaborationNav view={view} available={visibleViews} />;
    if (view === 'assign') {
      const { page, q } = filters;
      const [result, labels] = await Promise.all([listAssignablePosts(actor, { page, ...(q ? { q } : {}) }), readCollaborationLabels(actor)]);
      return <>{nav}<PageHeading title="Labels on posts" description="Tag many posts at once, or open a post to organize it in detail." />
        <BulkLabels initialPosts={result.posts.map(p => ({ ...p, scheduledAt: p.scheduledAt?.toISOString() ?? null }))} labels={labels.labels.map(({ id, name, color }) => ({ id, name, color }))} page={result.page} hasMore={result.hasMore} query={result.query} canWrite={canWrite} bulkLimit={result.bulkLimit} labelsPerPost={result.labelsPerPostLimit} searchMaxCharacters={maxCharacters} /></>;
    }
    if (view === 'fields') {
      const [fields, limit] = await Promise.all([readCustomFields(actor), bounds()]);
      const canManage = canWrite && (viewer.membership.role === 'owner' || viewer.membership.role === 'admin') && viewer.permissions.pageScope.all;
      return <>{nav}<PageHeading title="Custom fields" description="Track campaign codes, products or requesters on every post." />
        <FieldsManager initialFields={fields} canManage={canManage} limits={{ fieldLimit: limit.fieldLimit, nameMax: limit.fieldNameMax, optionMax: limit.fieldOptionMax, optionsMax: limit.fieldOptionsLimit }} /></>;
    }
    if (view === 'queue') {
      const [result, limit] = await Promise.all([readQueueSlots(actor), bounds()]);
      return <>{nav}<PageHeading title="Queue times" description="Choose the weekly times queued posts publish at." />
        <QueueTimes initialSlot={queueDefaultSlotSchema.parse(await runtimeConfig('publishing.queue.defaultSlot'))} timeZone={viewer.membership.workspace.timezone} slots={result.slots} targets={result.targets.map(({ id, name }) => ({ id, name }))} canEditShared={result.canEditShared} canEditChannels={result.canEditChannels} limit={limit.queueSlotLimit} /></>;
    }
    const mix = await readContentMix(actor);
    return <>{nav}<PageHeading title="Content mix" description="Balance what each channel posts by label." />
      <ContentMix targets={mix.targets.map(({ id, name }) => ({ id, name }))} groups={mix.groups} labels={mix.labels.map(({ id, name }) => ({ id, name }))} rules={mix.rules} status={mix.status} windowDays={mix.windowDays} maxPerWeek={mix.maxPerWeek} mixAutoFill={mix.mixAutoFill} canEditChannels={mix.canEditChannels} canEditGroups={mix.canEditGroups} canEditAutoFill={mix.canEditAutoFill} /></>;
  } catch (error) { return failure(error); }
}
