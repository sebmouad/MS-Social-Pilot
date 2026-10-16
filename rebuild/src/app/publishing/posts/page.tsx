import { DataTable, StatusChip, type TableColumn } from "@/components";
import { PostPreview, type PostPreviewPost } from "@/components/PostPreview";
import { requireViewer } from "@/server/context";
import { listPostPage } from "@/server/data";
import { publishingDestinationChoices } from '@/server/publishing/destinations';
import { PageHeading, PostMessage, PostTargets, formatDate } from "../publishing-ui";
import styles from "../publishing.module.css";
import previewStyles from '@/components/PostPreview.module.css';
import { CsvImportForm, PostRowActions } from "./PostActions";
import { runtimeConfig } from '@/server/config/store';
import { PostStatus } from '../../../../generated/client';

const NOTICE_TEXT: Record<string, string> = {
  created: "Post saved.",
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
  "publish-review": "Some destinations still need review. Their claimed publishing records were kept to prevent duplicate posts.",
  synced: "Remote status sync completed.",
};

export default async function PostsPage({ searchParams }: { searchParams: Promise<{ notice?: string; page?: string; status?: string; channel?: string; view?: string }> }) {
  const viewer = await requireViewer({ feature: 'publishing/posts', channelScoped: true });
  const { notice, page: pageParam, status, channel, view: viewParam } = await searchParams;
  const view = viewParam === 'feed' || viewParam === 'cards' ? viewParam : 'table';
  const [allowedMimeTypes, maxUploadBytes, maxAltCharacters] = await Promise.all([
    runtimeConfig('publishing.allowedImageMimeTypes'), runtimeConfig('publishing.maxImageUploadBytes'), runtimeConfig('publishing.maxImageAltCharacters'),
  ]);
  const imageRules = { allowedMimeTypes: allowedMimeTypes as string[], maxUploadBytes: Number(maxUploadBytes), maxAltCharacters: Number(maxAltCharacters) };
  const allowedTargetIds = viewer.permissions.pageScope.all ? null : viewer.permissions.pageScope.ids;
  const requestedPage = pageParam && /^\d+$/.test(pageParam) ? Number(pageParam) : 1;
  const selectedStatus = Object.values(PostStatus).find(value => value === status);
  const selectedChannel = channel || undefined;
  const listing = await listPostPage(viewer.workspaceId, requestedPage, 50, allowedTargetIds, viewer.user.id, { status: selectedStatus, channelId: selectedChannel });
  const targetChoices = await publishingDestinationChoices(viewer);
  const rows = listing.posts.map(post => ({ ...post, media: post.media as Array<{ kind: string; url: string; altText?: string }> }));
  const noticeText = notice ? NOTICE_TEXT[notice] ?? (notice.startsWith('imported-') ? `${notice.slice('imported-'.length)} posts imported as drafts.` : undefined) : undefined;
  const canManageDrafts = ["owner", "admin", "editor"].includes(viewer.membership.role);
  const canAuthorDrafts = canManageDrafts || viewer.membership.role === "contributor";
  const canPublish = targetChoices.some(target => target.canPublish);
  const pageLink = (page: number) => {
    const params = new URLSearchParams({ page: String(page) });
    if (selectedStatus) params.set('status', selectedStatus);
    if (channel) params.set('channel', channel);
    if (viewParam === 'table' || viewParam === 'feed' || viewParam === 'cards') params.set('view', viewParam);
    return `/publishing/posts?${params}`;
  };
  const actionFor = (post: (typeof rows)[number]) => {
    const canEdit = canManageDrafts || post.authorId === viewer.user.id;
    return <details className={previewStyles.managePost}>
      <summary>Manage post</summary>
      {canEdit ? <PostRowActions post={post} targets={targetChoices} canEdit={canEdit} canPublish={canPublish} imageRules={imageRules}/> : <span className={styles.noActions}>Post actions are limited to its author and workspace managers.</span>}
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
    { key: "post", label: "Post", render: post => <PostMessage message={post.message}/> },
    { key: "channels", label: "Channels", render: post => <PostTargets post={post}/> },
    { key: "status", label: "Status", render: post => <StatusChip status={post.status}/> },
    { key: "scheduled", label: "Publish time", render: post => <span className={styles.date}>{formatDate(post.scheduledAt ?? post.publishedAt, viewer.membership.workspace.timezone)}</span> },
  ];
  if (canAuthorDrafts) columns.push({ key: "actions", label: "Post actions", render: actionFor });
  return <>
    <PageHeading title="Posts" description="Create posts, choose destinations, publish, and review delivery status." summary={`${listing.total} ${listing.total === 1 ? "post" : "posts"} · page ${listing.page} of ${listing.pages}`}/>
    {noticeText ? <p className={notice?.startsWith('failed') ? styles.errorNotice : styles.successNotice} role={notice?.startsWith('failed') ? 'alert' : 'status'}>{noticeText}</p> : null}
    {canManageDrafts ? <div className={previewStyles.toolbar}><details className={previewStyles.importDisclosure}><summary>Import CSV</summary><section className={`${styles.card} ${styles.createCard}`}><p className={styles.help}>Upload a CSV of posts and optional first comments.</p><CsvImportForm targets={targetChoices}/></section></details></div> : null}
    <section className={styles.card} aria-label={`${view === 'table' ? 'Table' : view === 'feed' ? 'Feed' : 'Cards'} post view`}>
      {view === 'table' ? <DataTable columns={columns} rows={rows} rowKey={post => post.id} caption={`Posts, page ${listing.page} of ${listing.pages}`} emptyMessage={selectedStatus || selectedChannel ? 'No posts match these filters. Change or reset the filters to see other posts.' : 'No posts have been created in this workspace yet.'}/> : rows.length ? <ul className={view === 'feed' ? previewStyles.feedList : previewStyles.cardsGrid}>
        {rows.map(post => <li key={post.id}>{previewFor(post, view === 'feed' ? 'feed' : 'card')}</li>)}
      </ul> : <p className={styles.empty}>{selectedStatus || selectedChannel ? 'No posts match these filters. Change or reset the filters to see other posts.' : 'No posts have been created in this workspace yet.'}</p>}
      {listing.pages > 1 ? <nav className={styles.postPagination} aria-label="Post pages">
        {listing.page > 1 ? <a className="ui-button ui-button--secondary" href={pageLink(listing.page - 1)}>Previous page</a> : <span />}
        <span>Page {listing.page} of {listing.pages}</span>
        {listing.page < listing.pages ? <a className="ui-button ui-button--secondary" href={pageLink(listing.page + 1)}>Next page</a> : <span />}
      </nav> : null}
    </section>
  </>;
}
