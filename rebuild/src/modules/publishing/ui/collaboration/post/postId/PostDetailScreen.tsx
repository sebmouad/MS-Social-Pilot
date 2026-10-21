import { ComposerCopyProvider } from '@/modules/publishing/ui/compose/CopyProvider';
import { headers } from 'next/headers';
import { catalogGroup, fillComposerCopy } from '../../../../composer-catalog';
import { PublishingCopyProvider } from '@/modules/publishing/ui/kit/CopyProvider';
import { loadPublishingCopy } from '@/modules/publishing/server/customer-copy';
import { PublishingActionCopyProvider } from '@/modules/publishing/ui/WorkflowSubmitButtons';
import { loadPublishingActionCopy } from '@/modules/publishing/server/action-copy';
import { loadComposerCopy } from '../../../../server/composer-copy';
import { ensurePublishingCollaboration } from '@/modules/publishing/server/collaboration';
import { SidebarDock } from '@/components/SidebarDock';
import { parsePostCollaborationSearch } from '@/modules/publishing/collaboration/search';
import { notFound } from 'next/navigation';
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
import { PageHeading } from '@/modules/publishing/ui/publishing-ui';
import { PostPanel } from '@/modules/publishing/ui/collaboration/PostPanel';

async function PostCollaborationPageContent({ params, searchParams }: { params: Promise<{ postId: string }>; searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  ensurePublishingCollaboration();
  const { postId } = await params;
  const viewer = await requireViewer({ feature: 'publishing/collaboration', channelScoped: true });
  const actor = { userId: viewer.user.id, workspaceId: viewer.workspaceId };
  const copyCatalog = await loadComposerCopy();
  const locale = /^\s*fr\b/i.test((await headers()).get('accept-language') ?? '') ? 'fr' : 'en';
  const copy = catalogGroup(copyCatalog, 'collab', locale);
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
      <PageHeading title={copy.postTitle} description={copy.postHelp} />
      <SidebarDock><nav aria-label={copy.postNav}>
        <p><a href="/publishing/collaboration?view=assign">{copy.back}</a></p>
        <p>{fillComposerCopy(copy.notesPage, { page: notes.page })}</p>
        {notes.page > 1 && <p><a href={pageUrl(notes.page - 1, versions.page)}>{copy.newerNotes}</a></p>}
        {notes.hasMore && <p><a href={pageUrl(notes.page + 1, versions.page)}>{copy.olderNotes}</a></p>}
        {(versions.versions.length > 0 || versions.page > 1) && <><p>{fillComposerCopy(copy.historyPage, { page: versions.page })}</p>{versions.page > 1 && <p><a href={pageUrl(notes.page, versions.page - 1)}>{copy.newerVersions}</a></p>}{versions.hasMore && <p><a href={pageUrl(notes.page, versions.page + 1)}>{copy.olderVersions}</a></p>}</>}
      </nav></SidebarDock>
      <PostPanel copyCatalog={copyCatalog} timeZone={viewer.membership.workspace.timezone} key={`${postId}:${notes.page}:${versions.page}`} notesCanAdd={notes.page === 1} postId={postId} canWrite={canWrite} labels={labels.labels.map(({ id, name }) => ({ id, name }))} assigned={assigned.labels.map(l => l.id)}
        fields={fields.fields.map(f => ({ id: f.id, name: f.name, kind: f.kind, options: f.options, value: f.value }))}
        fieldValueMax={fields.maxCharacters}
        notes={notes.notes.map(n => ({ id: n.id, body: n.body, authorId: n.authorId, authorName: n.authorName, createdAt: n.createdAt.toISOString() }))}
        mentionable={caps.mentionNotifications ? notes.mentionable : []} noteMax={notes.maxCharacters} viewerId={notes.viewerId} canModerate={notes.viewerCanModerate}
        versions={versions.versions.map(v => ({ id: v.id, authorName: v.authorName, createdAt: v.createdAt.toISOString(), message: v.message, scheduledAt: v.scheduledAt?.toISOString() ?? null }))}
        restore={caps.versionRestore} canRestoreNow={canWrite && versions.restorable}
        recycle={recycle ? { enabled: recycle.enabled, everyDays: recycle.everyDays, limit: recycle.limit, count: recycle.count, nextAt: recycle.nextAt?.toISOString() ?? null, variants: recycle.variants, isRepeat: recycle.isRepeat, maxIntervalDays: recycle.limits.maxIntervalDays, maxRepeats: recycle.limits.maxRepeats, defaultIntervalDays: recycle.limits.defaultIntervalDays, maxVariants: recycle.limits.maxVariants } : null} />
    </>;
  } catch (error) {
    if (error instanceof OperationError && error.code === 'not_found') notFound();
    return <><PageHeading title={copy.postTitle} description={copy.postHelp} /><RouteNotice error focusKey="collab-post-error">{error instanceof OperationError ? error.message : copy.postFailure}</RouteNotice></>;
  }
}

export default async function PostCollaborationPage(props: Parameters<typeof PostCollaborationPageContent>[0]) {
  const [{ catalog }, actions, composerCatalog] = await Promise.all([loadPublishingCopy(), loadPublishingActionCopy(), loadComposerCopy()]);
  const locale = /^\s*fr\b/i.test((await headers()).get('accept-language') ?? '') ? 'fr' : 'en';
  return <PublishingCopyProvider catalog={catalog}><PublishingActionCopyProvider catalog={actions} locale={locale}><ComposerCopyProvider catalog={composerCatalog} locale={locale}>{await PostCollaborationPageContent(props)}</ComposerCopyProvider></PublishingActionCopyProvider></PublishingCopyProvider>;
}
