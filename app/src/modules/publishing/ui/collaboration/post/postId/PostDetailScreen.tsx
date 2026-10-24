import { ComposerCopyProvider } from '@/modules/publishing/ui/compose/CopyProvider';
import { headers } from 'next/headers';
import { catalogGroup, fillComposerCopy } from '../../../../composer-catalog';
import { PublishingCopyProvider } from '@/modules/publishing/ui/kit/CopyProvider';
import { loadPublishingCopy } from '@/modules/publishing/server/customer-copy';
import { PublishingActionCopyProvider } from '@/modules/publishing/ui/WorkflowSubmitButtons';
import { loadPublishingActionCopy } from '@/modules/publishing/server/action-copy';
import { loadComposerCopy } from '../../../../server/composer-copy';
import { ensurePublishingCollaboration } from '@/modules/publishing/server/collaboration';
import { InfoTip, PageHeader } from '@/components';
import { RetryFailedDestinations } from '@/modules/publishing/ui/posts/PostActions';
import { retryableDestinationCount } from '@/modules/publishing/bulk';
import { PostPreview, type PostPreviewPost } from '@/components/PostPreview';
import { readPublishingPostPage } from '@/modules/publishing/server/read';
import { loadContent } from '@/modules/publishing/server/content-copy';
import styles from './post-detail.module.css';
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
import { PostPanel } from '@/modules/publishing/ui/collaboration/PostPanel';
import { loadPostReach } from '@/modules/publishing/server/post-reach';
import { PostPerformanceCard } from './PostPerformanceCard';

async function PostCollaborationPageContent({ params, searchParams }: { params: Promise<{ postId: string }>; searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  ensurePublishingCollaboration();
  const { postId } = await params;
  const viewer = await requireViewer({ feature: 'publishing/collaboration', channelScoped: true });
  const actor = { userId: viewer.user.id, workspaceId: viewer.workspaceId };
  const copyCatalog = await loadComposerCopy();
  const locale = /^\s*fr\b/i.test((await headers()).get('accept-language') ?? '') ? 'fr' : 'en';
  const copy = catalogGroup(copyCatalog, 'collab', locale);
  const content = await loadContent();
  const memberName = (await loadPublishingCopy()).copy[locale].approvalsMember;
  const canWrite = canAccessFeature(viewer.permissions, 'publishing/collaboration', 'write');
  const canPublish = canAccessFeature(viewer.permissions, 'publishing/posts', 'write');
  const caps = collaborationCapabilities();
  try {
    const paging = parsePostCollaborationSearch(await searchParams ?? {});
    const pageUrl = (notesPage: number, versionsPage: number) => `/content/post/${encodeURIComponent(postId)}?${new URLSearchParams({ notesPage: String(notesPage), versionsPage: String(versionsPage) })}`;
    const [assigned, labels, fields, notes, versions, recycle, listing, metricsMap] = await Promise.all([
      readPostLabels(actor, postId), readCollaborationLabels(actor), readPostFieldValues(actor, postId), readPostNotes(actor, { postId, page: paging.notesPage }), readPostVersions(actor, { postId, page: paging.versionsPage }),
      caps.recycle ? readRecycle(actor, { postId }) : Promise.resolve(null),
      // The post itself, through the same visibility rules as the Posts list; a failure only hides the summary.
      readPublishingPostPage(actor, { postId }).catch(() => null),
      loadPostReach(actor.workspaceId, [postId]).catch(() => new Map()),
    ]);
    const post = listing?.posts[0];
    const postMetrics = metricsMap.get(postId) ?? null;
    const timeZone = viewer.membership.workspace.timezone;
    // Times are formatted here so the browser never applies its own time-zone data.
    const stampFormat = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone });
    const stamp = (value: Date) => stampFormat.format(value);
    const zoned = (value: Date) => `${stamp(value)} ${timeZone}`;
    return <>
      <PageHeader module="publishing" title={copy.postTitle} info={<InfoTip name={copy.postTitle}>{content.copy.postDetailInfo}</InfoTip>}
        breadcrumbs={<a href="/content">{content.copy.postDetailBack}</a>} />
      {post ? <section aria-label={copy.postTitle} className={styles.summary}>
        <PostPreview post={post as PostPreviewPost} authorName={post.authorId === viewer.user.id ? viewer.user.name : memberName} timeZone={timeZone} locale={locale} variant="card" metrics={postMetrics ?? undefined} />
        {/* The preview already lists each destination with its status; offer the recovery action instead of repeating them. */}
        {canPublish ? <div className={styles.destinations}><RetryFailedDestinations postId={post.id} count={retryableDestinationCount(post)} /></div> : null}
      </section> : null}
      {post ? <PostPerformanceCard postId={post.id} initialMetrics={postMetrics} locale={locale} timeZone={timeZone} /> : null}
      {(notes.page > 1 || notes.hasMore || versions.page > 1 || versions.hasMore) && <nav aria-label={copy.postNav} className={styles.paging}>
        {(notes.page > 1 || notes.hasMore) && <span>{fillComposerCopy(copy.notesPage, { page: notes.page })}</span>}
        {notes.page > 1 && <a href={pageUrl(notes.page - 1, versions.page)}>{copy.newerNotes}</a>}
        {notes.hasMore && <a href={pageUrl(notes.page + 1, versions.page)}>{copy.olderNotes}</a>}
        {(versions.page > 1 || versions.hasMore) && <><span>{fillComposerCopy(copy.historyPage, { page: versions.page })}</span>{versions.page > 1 && <a href={pageUrl(notes.page, versions.page - 1)}>{copy.newerVersions}</a>}{versions.hasMore && <a href={pageUrl(notes.page, versions.page + 1)}>{copy.olderVersions}</a>}</>}
      </nav>}
      <PostPanel copyCatalog={copyCatalog} timeZone={viewer.membership.workspace.timezone} key={`${postId}:${notes.page}:${versions.page}`} notesCanAdd={notes.page === 1} postId={postId} canWrite={canWrite} labels={labels.labels.map(({ id, name }) => ({ id, name }))} assigned={assigned.labels.map(l => l.id)}
        fields={fields.fields.map(f => ({ id: f.id, name: f.name, kind: f.kind, options: f.options, value: f.value }))}
        fieldValueMax={fields.maxCharacters}
        notes={notes.notes.map(n => ({ id: n.id, body: n.body, authorId: n.authorId, authorName: n.authorName, createdAt: n.createdAt.toISOString(), createdLabel: zoned(n.createdAt) }))}
        mentionable={caps.mentionNotifications ? notes.mentionable : []} noteMax={notes.maxCharacters} viewerId={notes.viewerId} canModerate={notes.viewerCanModerate}
        versions={versions.versions.map(v => ({ id: v.id, authorName: v.authorName, createdAt: v.createdAt.toISOString(), createdLabel: stamp(v.createdAt), message: v.message, scheduledAt: v.scheduledAt?.toISOString() ?? null }))}
        restore={caps.versionRestore} canRestoreNow={canWrite && versions.restorable}
        recycle={recycle ? { enabled: recycle.enabled, everyDays: recycle.everyDays, limit: recycle.limit, count: recycle.count, nextAt: recycle.nextAt?.toISOString() ?? null, nextLabel: recycle.nextAt ? zoned(recycle.nextAt) : null, variants: recycle.variants, isRepeat: recycle.isRepeat, maxIntervalDays: recycle.limits.maxIntervalDays, maxRepeats: recycle.limits.maxRepeats, defaultIntervalDays: recycle.limits.defaultIntervalDays, maxVariants: recycle.limits.maxVariants } : null} />
    </>;
  } catch (error) {
    if (error instanceof OperationError && error.code === 'not_found') notFound();
    return <><PageHeader module="publishing" title={copy.postTitle} breadcrumbs={<a href="/content">{content.copy.postDetailBack}</a>} /><RouteNotice error focusKey="collab-post-error">{error instanceof OperationError ? error.message : copy.postFailure}</RouteNotice></>;
  }
}

export default async function PostCollaborationPage(props: Parameters<typeof PostCollaborationPageContent>[0]) {
  const [{ catalog }, actions, composerCatalog] = await Promise.all([loadPublishingCopy(), loadPublishingActionCopy(), loadComposerCopy()]);
  const locale = /^\s*fr\b/i.test((await headers()).get('accept-language') ?? '') ? 'fr' : 'en';
  return <PublishingCopyProvider catalog={catalog}><PublishingActionCopyProvider catalog={actions} locale={locale}><ComposerCopyProvider catalog={composerCatalog} locale={locale}>{await PostCollaborationPageContent(props)}</ComposerCopyProvider></PublishingActionCopyProvider></PublishingCopyProvider>;
}
