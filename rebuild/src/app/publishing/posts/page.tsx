import { DataTable, type TableColumn } from "@/components";
import { requireViewer } from "@/server/context";
import { getTargets, listPostPage } from "@/server/data";
import { PageHeading, PostMessage, PostTargets, StatusBadge, formatDate } from "../publishing-ui";
import styles from "../publishing.module.css";
import { CsvImportForm, PostEditorForm, PostRowActions } from "./PostActions";
import { hasPlatformCapability } from "@/server/entitlements";
import { platformFor } from '@/server/platforms/registry';
import { runtimeConfig } from '@/server/config/store';

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

export default async function PostsPage({ searchParams }: { searchParams: Promise<{ notice?: string; page?: string }> }) {
  const viewer = await requireViewer({ feature: 'publishing/posts', channelScoped: true });
  const { notice, page: pageParam } = await searchParams;
  const [allowedMimeTypes, maxUploadBytes, maxAltCharacters] = await Promise.all([
    runtimeConfig('publishing.allowedImageMimeTypes'), runtimeConfig('publishing.maxImageUploadBytes'), runtimeConfig('publishing.maxImageAltCharacters'),
  ]);
  const imageRules = { allowedMimeTypes: allowedMimeTypes as string[], maxUploadBytes: Number(maxUploadBytes), maxAltCharacters: Number(maxAltCharacters) };
  const allowedTargetIds = viewer.permissions.pageScope.all ? null : viewer.permissions.pageScope.ids;
  const requestedPage = pageParam && /^\d+$/.test(pageParam) ? Number(pageParam) : 1;
  const listing = await listPostPage(viewer.workspaceId, requestedPage, 50, allowedTargetIds, viewer.user.id);
  const targetRows = await getTargets(viewer.workspaceId);
  const scopedTargetRows = allowedTargetIds === null ? targetRows : targetRows.filter(target => allowedTargetIds.includes(target.id));
  const targetChoices = await Promise.all(scopedTargetRows.map(async target => {
    const provider = target.socialAccount?.provider ?? null;
    const adapter = provider && hasPlatformCapability(viewer.entitlements, provider) ? await platformFor(provider, 'publishing') : null;
    return { id: target.id, name: target.name, type: target.type, provider, canPublish: Boolean(target.canPublish && !target.socialAccount?.invalidatedAt && adapter?.publish && adapter.supportsTargetKind?.(target.type, 'publishing')) };
  }));
  const rows = listing.posts.map(post => ({ ...post, media: post.media as Array<{ kind: string; url: string }> }));
  const noticeText = notice ? NOTICE_TEXT[notice] ?? (notice.startsWith('imported-') ? `${notice.slice('imported-'.length)} posts imported as drafts.` : undefined) : undefined;
  const canManageDrafts = ["owner", "admin", "editor"].includes(viewer.membership.role);
  const canAuthorDrafts = canManageDrafts || viewer.membership.role === "contributor";
  const canPublish = targetChoices.some(target => target.canPublish);
  const columns: TableColumn<(typeof rows)[number]>[] = [
    { key: "post", label: "Post", render: post => <PostMessage message={post.message}/> },
    { key: "channels", label: "Channels", render: post => <PostTargets post={post}/> },
    { key: "status", label: "Status", render: post => <StatusBadge status={post.status}/> },
    { key: "scheduled", label: "Publish time", render: post => <span className={styles.date}>{formatDate(post.scheduledAt ?? post.publishedAt, viewer.membership.workspace.timezone)}</span> },
  ];
  if (canAuthorDrafts) columns.push({ key: "actions", label: "Post actions", render: post => {
    const canEdit = canManageDrafts || post.authorId === viewer.user.id;
    return canEdit ? <PostRowActions post={post} targets={targetChoices} canEdit={canEdit} canPublish={canPublish} imageRules={imageRules}/> : <span className={styles.noActions}>Post actions are limited to its author and workspace managers.</span>;
  } });
  return <>
    <PageHeading title="Posts" description="Create posts, choose destinations, publish, and review delivery status." summary={`${listing.total} ${listing.total === 1 ? "post" : "posts"} · page ${listing.page} of ${listing.pages}`}/>
    {noticeText ? <p className={notice?.startsWith('failed') ? styles.errorNotice : styles.successNotice} role={notice?.startsWith('failed') ? 'alert' : 'status'}>{noticeText}</p> : null}
    {(canAuthorDrafts || canManageDrafts) ? <div className={styles.postWorkbench}>
      {canAuthorDrafts ? <section className={`${styles.card} ${styles.createCard}`}><h2>Create a post</h2><p>Choose an enabled destination now or save this as a local draft.</p><PostEditorForm targets={targetChoices} imageRules={imageRules}/></section> : null}
      {canManageDrafts ? <section className={`${styles.card} ${styles.createCard} ${styles.importCard}`}><h2>Import a batch</h2><p>Upload a CSV of posts and optional first comments.</p><CsvImportForm targets={targetChoices}/></section> : null}
    </div> : null}
    <section className={styles.card}><DataTable columns={columns} rows={rows} rowKey={post => post.id} caption={`Posts, page ${listing.page} of ${listing.pages}`} emptyMessage="No posts have been created in this workspace yet."/>
      {listing.pages > 1 ? <nav className={styles.postPagination} aria-label="Post pages">
        {listing.page > 1 ? <a className="ui-button ui-button--secondary" href={`/publishing/posts?page=${listing.page - 1}`}>Previous page</a> : <span />}
        <span>Page {listing.page} of {listing.pages}</span>
        {listing.page < listing.pages ? <a className="ui-button ui-button--secondary" href={`/publishing/posts?page=${listing.page + 1}`}>Next page</a> : <span />}
      </nav> : null}
    </section>
  </>;
}
