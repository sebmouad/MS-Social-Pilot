import { DataTable, StatusChip, type TableColumn } from "@/components";
import { PostPreview, type PostPreviewPost } from "@/components/PostPreview";
import { requireViewer } from "@/server/context";
import { readPublishingPostPage } from "@/modules/publishing/server/read";
import { publishingDestinationChoices } from '@/server/publishing/destinations';
import { PageHeading, PostMessage, PostTargets, formatDate } from "../publishing-ui";
import styles from "../publishing.module.css";
import previewStyles from '@/components/PostPreview.module.css';
import { CsvImportForm, PostRowActions } from "./PostActions";
import { BulkPostActions, BulkSelect } from "./BulkPostActions";
import { runtimeConfig } from '@/server/config/store';
import { RouteNotice } from '@/components/RouteNotice';
import { PostStatus } from '../../../../generated/client';
import { canUseFeature } from '@/server/entitlements';
import { canAccessFeature } from '@/server/permissions';
import { OperationError, isOperationErrorCode } from '@/lib/operation-error';

const NOTICE_TEXT: Record<string, string> = {
  created: "Post saved.",
  "publication-finished": "Local publication record updated. No new publication or first comment was sent.",
  "publication-absent": "Human-verified absence recorded. No publication was sent. Check the destination again before a separate retry.",
  updated: "Post saved.",
  deleted: "Post deleted locally.",
  failed: "The publishing action could not be completed. Check permissions, connection status, and post state, then try again.",
  'failed-import': "The CSV could not be imported. Check its header, row format, and file size, then try again.",
  'failed-image': "The image could not be used for every selected destination. Check its type and size, or choose another image.",
  'failed-remote-delete': "Remote deletion could not be confirmed. The local post and delivery history were preserved. Reconnect the source or try again.",
  'failed-access': "Your role or channel access does not permit this action.",
  'failed-state': "This post is no longer eligible for that action. Refresh the page and review its current status.",
  published: "Publishing completed.",
  submitted: "Post submitted for approval.",
  scheduled: "Post added to the queue.",
  cancelled: "Scheduled post returned to drafts.",
  "publish-review": "Some destinations or first comments need attention. Review their individual delivery states before another action.",
  synced: "Remote status sync completed.",
  "failed-sync": "No new delivery status was confirmed. Check the post on its platform, then try syncing again.",
  duplicated: "A new unscheduled draft was created.",
};

export default async function PostsPage({ searchParams }: { searchParams: Promise<{ notice?: string; recovery?: string; page?: string; status?: string; channel?: string; q?: string; view?: string }> }) {
  const viewer = await requireViewer({ feature: 'publishing/posts', channelScoped: true });
  const { notice, recovery, page: pageParam, status, channel, q, view: viewParam } = await searchParams;
  const view = viewParam === 'feed' || viewParam === 'cards' ? viewParam : 'table';
  const [allowedMimeTypes, maxUploadBytes, maxAltCharacters, maxMedia, maxFirstCommentDelayMinutes] = await Promise.all([
    runtimeConfig('publishing.allowedImageMimeTypes'), runtimeConfig('publishing.maxImageUploadBytes'), runtimeConfig('publishing.maxImageAltCharacters'), runtimeConfig('publishing.maxRemoteMediaPerPost'), runtimeConfig('publishing.maxFirstCommentDelayMinutes'),
  ]);
  const imageRules = { allowedMimeTypes: allowedMimeTypes as string[], maxUploadBytes: Number(maxUploadBytes), maxAltCharacters: Number(maxAltCharacters), maxMedia: Number(maxMedia), maxFirstCommentDelayMinutes: Number(maxFirstCommentDelayMinutes) };
  const requestedPage = pageParam && /^[1-9]\d*$/.test(pageParam) && Number.isSafeInteger(Number(pageParam)) ? Number(pageParam) : 1;
  const selectedStatus = Object.values(PostStatus).find(value => value === status);
  const selectedChannel = channel || undefined;
  let listing: Awaited<ReturnType<typeof readPublishingPostPage>> | null = null;
  let listingError: string | null = null;
  try {
    listing = await readPublishingPostPage({ userId: viewer.user.id, workspaceId: viewer.workspaceId }, { page: requestedPage, status, channelId: selectedChannel, q });
  } catch (error) {
    if (!(error instanceof OperationError) || !isOperationErrorCode(error.code)) throw error;
    listingError = safeOperationError(error);
  }
  if (!listing) return <>
    <PageHeading title="Posts" description="Create posts, choose destinations, publish, and review delivery status." summary="Posts could not be loaded" />
    <RouteNotice className={styles.errorNotice} error focusKey={`posts-read-error:${q ?? ''}:${status ?? ''}:${channel ?? ''}`}>{`${listingError ?? 'Posts could not be loaded.'} Reset the sidebar filters and try again.`}</RouteNotice>
  </>;
  const targetChoices = await publishingDestinationChoices(viewer);
  const rows = listing.posts.map(post => ({ ...post, media: post.media as Array<{ kind: string; url: string; altText?: string }> }));
  const noticeText = notice ? NOTICE_TEXT[notice] ?? (notice.startsWith('imported-') ? `${notice.slice('imported-'.length)} posts imported as drafts.` : undefined) : undefined;
  const canManageDrafts = ["owner", "admin", "editor"].includes(viewer.membership.role);
  const canAuthorDrafts = canManageDrafts || viewer.membership.role === "contributor";
  const canWritePosts = canAccessFeature(viewer.permissions, 'publishing/posts', 'write');
  const canPublish = targetChoices.some(target => target.canPublish);
  const pageLink = (page: number) => {
    const params = new URLSearchParams({ page: String(page) });
    if (status) params.set('status', status);
    if (channel) params.set('channel', channel);
    if (q) params.set('q', q);
    if (viewParam === 'table' || viewParam === 'feed' || viewParam === 'cards') params.set('view', viewParam);
    return `/publishing/posts?${params}`;
  };
  const actionFor = (post: (typeof rows)[number]) => {
    const canEdit = canManageDrafts || post.authorId === viewer.user.id;
    const canDuplicate = canWritePosts
      && (canManageDrafts || (viewer.membership.role === 'contributor' && post.authorId === viewer.user.id))
      && canEdit
      && !['processing', 'publishing', 'scheduled_remote'].includes(post.status)
      && !post.targets.some(target => target.status === 'processing' || target.status === 'scheduled_remote');
    return <details className={previewStyles.managePost}>
      <summary>Manage post</summary>
      {canEdit ? <PostRowActions post={post} targets={targetChoices} canEdit={canEdit} canPublish={canPublish} canOrganize={canUseFeature(viewer.entitlements, 'publishing/collaboration') && canAccessFeature(viewer.permissions, 'publishing/collaboration', 'read')} canDuplicate={canDuplicate} canQueue={canWritePosts && canUseFeature(viewer.entitlements, 'publishing/queue') && canAccessFeature(viewer.permissions, 'publishing/queue', 'write')} timeZone={viewer.membership.workspace.timezone} imageRules={imageRules}/> : <span className={styles.noActions}>Post actions are limited to its author and workspace managers.</span>}
    </details>;
  };
  const previewFor = (post: (typeof rows)[number], variant: 'feed' | 'card') => <PostPreview
    post={post as PostPreviewPost}
    authorName={post.authorId === viewer.user.id ? viewer.user.name : 'Workspace member'}
    timeZone={viewer.membership.workspace.timezone}
    variant={variant}
    actions={canAuthorDrafts ? actionFor(post) : undefined}
  />;
  const columns: TableColumn<(typeof rows)[number]>[] = [
    { key: "post", label: "Post", render: post => <PostMessage message={post.message} media={post.media} link={post.link}/> },
    { key: "channels", label: "Channels", render: post => <PostTargets post={post}/> },
    { key: "status", label: "Status", render: post => <StatusChip status={post.status}/> },
    { key: "scheduled", label: "Publish time", render: post => <span className={styles.date}>{formatDate(post.scheduledAt ?? post.publishedAt, viewer.membership.workspace.timezone)}</span> },
  ];
  if (canAuthorDrafts) columns.push({ key: "actions", label: "Post actions", render: actionFor });
  const canBulk = canWritePosts && canAuthorDrafts && view === 'table' && rows.length > 0;
  if (canBulk) columns.unshift({ key: "select", label: "Select", render: post => <BulkSelect postId={post.id} label={post.message.slice(0, 60) || post.id} /> });
  return <>
    <PageHeading title="Posts" description="Create posts, choose destinations, publish, and review delivery status." summary={`${listing.total} ${listing.total === 1 ? "post" : "posts"} · page ${listing.page} of ${listing.pages}`}/>
    {listing.channelUnavailable ? <p className={styles.errorNotice} role="status">The selected channel is unavailable. Choose another channel or reset the sidebar filters.</p> : null}
    {noticeText ? <RouteNotice className={notice?.startsWith('failed') ? styles.errorNotice : styles.successNotice} error={notice?.startsWith('failed')} focusKey={`${notice}:${recovery ?? ''}`}>{noticeText}</RouteNotice> : null}
    {canManageDrafts ? <div className={previewStyles.toolbar}><details className={previewStyles.importDisclosure}><summary>Import CSV</summary><section className={`${styles.card} ${styles.createCard}`}><p className={styles.help}>Upload a CSV of posts and optional first comments.</p><CsvImportForm targets={targetChoices}/></section></details></div> : null}
    {canBulk ? <BulkPostActions canRetry={canPublish} /> : null}
    <section className={styles.card} aria-label={`${view === 'table' ? 'Table' : view === 'feed' ? 'Feed' : 'Cards'} post view`}>
      {view === 'table' ? <DataTable columns={columns} rows={rows} rowKey={post => post.id} caption={`Posts, page ${listing.page} of ${listing.pages}`} emptyMessage={selectedStatus || selectedChannel || q?.trim() ? 'No posts match these filters. Change or reset the filters to see other posts.' : 'No posts have been created in this workspace yet.'}/> : rows.length ? <ul className={view === 'feed' ? previewStyles.feedList : previewStyles.cardsGrid}>
        {rows.map(post => <li key={post.id}>{previewFor(post, view === 'feed' ? 'feed' : 'card')}</li>)}
      </ul> : <p className={styles.empty}>{selectedStatus || selectedChannel || q?.trim() ? 'No posts match these filters. Change or reset the filters to see other posts.' : 'No posts have been created in this workspace yet.'}</p>}
      {listing.pages > 1 ? <nav className={styles.postPagination} aria-label="Post pages">
        {listing.page > 1 ? <a className="ui-button ui-button--secondary" href={pageLink(listing.page - 1)}>Previous page</a> : <span />}
        <span>Page {listing.page} of {listing.pages}</span>
        {listing.page < listing.pages ? <a className="ui-button ui-button--secondary" href={pageLink(listing.page + 1)}>Next page</a> : <span />}
      </nav> : null}
    </section>
  </>;
}

function safeOperationError(error: unknown) {
  const code = error instanceof OperationError && isOperationErrorCode(error.code) ? error.code : null;
  if (code === 'invalid_request' && error instanceof OperationError) return error.message;
  if (code === 'unauthorized' || code === 'forbidden') return 'You do not have permission to read these posts.';
  if (code === 'not_found') return 'These posts are no longer available.';
  if (code === 'unavailable' || code === 'conflict') return 'Posts are temporarily unavailable.';
  return 'Posts could not be loaded. Refresh the page and try again.';
}
