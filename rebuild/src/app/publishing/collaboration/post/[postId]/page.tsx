import { OperationError } from '@/lib/operation-error';
import { RouteNotice } from '@/components/RouteNotice';
import { requireViewer } from '@/server/context';
import { canAccessFeature } from '@/server/permissions';
import { collaborationCapabilities } from '@/modules/publishing/collaboration/ports';
import { readPostLabels } from '@/modules/publishing/collaboration/server/assignments';
import { readPostFieldValues } from '@/modules/publishing/collaboration/server/custom-fields';
import { readPostNotes } from '@/modules/publishing/collaboration/server/notes';
import { readRecycle } from '@/modules/publishing/collaboration/server/recycle';
import { readPostVersions } from '@/modules/publishing/collaboration/server/versions';
import { readLabelPage } from '@/modules/publishing/server/labels';
import { PageHeading } from '../../../publishing-ui';
import { PostPanel } from '../../PostPanel';

export default async function PostCollaborationPage({ params }: { params: Promise<{ postId: string }> }) {
  const { postId } = await params;
  const viewer = await requireViewer({ feature: 'publishing/posts', channelScoped: true });
  const actor = { userId: viewer.user.id, workspaceId: viewer.workspaceId };
  const canWrite = canAccessFeature(viewer.permissions, 'publishing/posts', 'write');
  const caps = collaborationCapabilities();
  try {
    const [assigned, labels, fields, notes, versions, recycle] = await Promise.all([
      readPostLabels(actor, postId), readLabelPage(actor, { page: 1 }), readPostFieldValues(actor, postId), readPostNotes(actor, { postId }), readPostVersions(actor, { postId }),
      caps.recycle ? readRecycle(actor, { postId }) : Promise.resolve(null),
    ]);
    return <>
      <PageHeading title="Organize post" description="Labels, fields, team notes, history and repeats for this post." />
      <p><a href="/publishing/collaboration?view=assign">Back to all posts</a></p>
      <PostPanel postId={postId} canWrite={canWrite} labels={labels.labels.map(({ id, name }) => ({ id, name }))} assigned={assigned.labels.map(l => l.id)}
        fields={fields.fields.map(f => ({ id: f.id, name: f.name, kind: f.kind, options: f.options, value: f.value }))}
        notes={notes.notes.map(n => ({ id: n.id, body: n.body, authorId: n.authorId, authorName: n.authorName, createdAt: n.createdAt.toISOString() }))}
        mentionable={notes.mentionable} noteMax={notes.maxCharacters} viewerId={notes.viewerId} canModerate={notes.viewerCanModerate}
        versions={versions.versions.map(v => ({ id: v.id, authorName: v.authorName, createdAt: v.createdAt.toISOString(), message: v.message, scheduledAt: v.scheduledAt?.toISOString() ?? null }))}
        restore={caps.versionRestore} canRestoreNow={canWrite}
        recycle={recycle ? { enabled: recycle.enabled, everyDays: recycle.everyDays, limit: recycle.limit, count: recycle.count, nextAt: recycle.nextAt?.toISOString() ?? null, variants: recycle.variants, isRepeat: recycle.isRepeat, maxIntervalDays: recycle.limits.maxIntervalDays, maxRepeats: recycle.limits.maxRepeats, defaultIntervalDays: recycle.limits.defaultIntervalDays, maxVariants: recycle.limits.maxVariants } : null} />
    </>;
  } catch (error) {
    return <><PageHeading title="Organize post" description="Labels, fields, team notes, history and repeats for this post." /><RouteNotice error focusKey="collab-post-error">{error instanceof OperationError ? error.message : 'This post could not be loaded. Refresh and try again.'}</RouteNotice></>;
  }
}
