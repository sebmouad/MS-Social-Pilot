import { ensurePublishingCollaboration } from '@/server/publishing/collaboration';
import { SidebarDock } from '@/components/SidebarDock';
import { parsePostCollaborationSearch } from '@/modules/publishing/collaboration/search';
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
import { readCollaborationLabels } from '@/modules/publishing/collaboration/server/label-choices';
import { PageHeading } from '../../../publishing-ui';
import { PostPanel } from '../../PostPanel';

export default async function PostCollaborationPage({ params, searchParams }: { params: Promise<{ postId: string }>; searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  ensurePublishingCollaboration();
  const { postId } = await params;
  const viewer = await requireViewer({ feature: 'publishing/collaboration', channelScoped: true });
  const actor = { userId: viewer.user.id, workspaceId: viewer.workspaceId };
  const canWrite = canAccessFeature(viewer.permissions, 'publishing/collaboration', 'write');
  const caps = collaborationCapabilities();
  try {
    const paging = parsePostCollaborationSearch(await searchParams ?? {});
    const pageUrl = (notesPage: number, versionsPage: number) => `/publishing/collaboration/post/${encodeURIComponent(postId)}?${new URLSearchParams({ notesPage: String(notesPage), versionsPage: String(versionsPage) })}`;
    const [assigned, labels, fields, notes, versions, recycle] = await Promise.all([
      readPostLabels(actor, postId), readCollaborationLabels(actor), readPostFieldValues(actor, postId), readPostNotes(actor, { postId, page: paging.notesPage }), readPostVersions(actor, { postId, page: paging.versionsPage }),
      caps.recycle ? readRecycle(actor, { postId }) : Promise.resolve(null),
    ]);
    return <>
      <PageHeading title="Organize post" description="Manage labels, custom fields and internal team notes." />
      <SidebarDock><nav aria-label="Post organization pages">
        <p><a href="/publishing/collaboration?view=assign">Back to all posts</a></p>
        <p>Notes · page {notes.page}</p>
        {notes.page > 1 && <p><a href={pageUrl(notes.page - 1, versions.page)}>Newer notes</a></p>}
        {notes.hasMore && <p><a href={pageUrl(notes.page + 1, versions.page)}>Older notes</a></p>}
        {(versions.versions.length > 0 || versions.page > 1) && <><p>History · page {versions.page}</p>{versions.page > 1 && <p><a href={pageUrl(notes.page, versions.page - 1)}>Newer versions</a></p>}{versions.hasMore && <p><a href={pageUrl(notes.page, versions.page + 1)}>Older versions</a></p>}</>}
      </nav></SidebarDock>
      <PostPanel timeZone={viewer.membership.workspace.timezone} key={`${postId}:${notes.page}:${versions.page}`} notesCanAdd={notes.page === 1} postId={postId} canWrite={canWrite} labels={labels.labels.map(({ id, name }) => ({ id, name }))} assigned={assigned.labels.map(l => l.id)}
        fields={fields.fields.map(f => ({ id: f.id, name: f.name, kind: f.kind, options: f.options, value: f.value }))}
        fieldValueMax={fields.maxCharacters}
        notes={notes.notes.map(n => ({ id: n.id, body: n.body, authorId: n.authorId, authorName: n.authorName, createdAt: n.createdAt.toISOString() }))}
        mentionable={caps.mentionNotifications ? notes.mentionable : []} noteMax={notes.maxCharacters} viewerId={notes.viewerId} canModerate={notes.viewerCanModerate}
        versions={versions.versions.map(v => ({ id: v.id, authorName: v.authorName, createdAt: v.createdAt.toISOString(), message: v.message, scheduledAt: v.scheduledAt?.toISOString() ?? null }))}
        restore={caps.versionRestore} canRestoreNow={canWrite && versions.restorable}
        recycle={recycle ? { enabled: recycle.enabled, everyDays: recycle.everyDays, limit: recycle.limit, count: recycle.count, nextAt: recycle.nextAt?.toISOString() ?? null, variants: recycle.variants, isRepeat: recycle.isRepeat, maxIntervalDays: recycle.limits.maxIntervalDays, maxRepeats: recycle.limits.maxRepeats, defaultIntervalDays: recycle.limits.defaultIntervalDays, maxVariants: recycle.limits.maxVariants } : null} />
    </>;
  } catch (error) {
    return <><PageHeading title="Organize post" description="Manage labels, custom fields and internal team notes." /><RouteNotice error focusKey="collab-post-error">{error instanceof OperationError ? error.message : 'This post could not be loaded. Refresh and try again.'}</RouteNotice></>;
  }
}
