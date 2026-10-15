import { DataTable, type TableColumn } from "@/components";
import { requireViewer } from "@/server/context";
import { listPostPage } from "@/server/data";
import { PageHeading, PostMessage, PostTargets, PublishingPagination, formatDate } from "../publishing-ui";
import styles from "../publishing.module.css";
import { reviewPostAction } from "../posts/actions";

export default async function ApprovalsPage({ searchParams }: { searchParams: Promise<{ notice?: string; page?: string }> }) {
  const viewer = await requireViewer({ feature: 'publishing/approvals', channelScoped: true });
  const allowedTargetIds = viewer.permissions.pageScope.all ? null : viewer.permissions.pageScope.ids;
  const { notice, page: pageParam } = await searchParams;
  const requestedPage = pageParam && /^\d+$/.test(pageParam) ? Number(pageParam) : 1;
  const listing = await listPostPage(viewer.workspaceId, requestedPage, 50, allowedTargetIds, viewer.user.id, { status: 'pending_approval', order: 'created_asc' });
  const posts = listing.posts;
  const columns: TableColumn<(typeof posts)[number]>[] = [
    { key: "post", label: "Post", render: post => <PostMessage message={post.message}/> },
    { key: "channels", label: "Channels", render: post => <PostTargets post={post}/> },
    { key: "submitted", label: "Created", render: post => <span className={styles.date}>{formatDate(post.createdAt, viewer.membership.workspace.timezone)}</span> },
  ];
  if (viewer.permissions.features['publishing/approvals'].write) columns.push({ key: "review", label: "Review", render: post => <div className={styles.rowActions}>
    <form action={reviewPostAction}><input type="hidden" name="postId" value={post.id}/><input type="hidden" name="decision" value="approve"/><button className="ui-button ui-button--primary ui-button--sm" type="submit">Approve</button></form>
    <form action={reviewPostAction}><input type="hidden" name="postId" value={post.id}/><input type="hidden" name="decision" value="reject"/><button className="ui-button ui-button--secondary ui-button--sm" type="submit">Reject</button></form>
  </div> });
  const noticeText = notice === 'approved' ? 'Post approved and returned to drafts.' : notice === 'rejected' ? 'Post rejected.' : notice === 'failed' ? 'The review could not be completed. Check the post state and your permissions.' : undefined;
  return <><PageHeading title="Approvals" description="Posts currently marked as awaiting approval." summary={`${listing.total} awaiting ${listing.total === 1 ? "review" : "reviews"} · page ${listing.page} of ${listing.pages}`} />{noticeText ? <p className={notice === 'failed' ? styles.errorNotice : styles.successNotice} role="status">{noticeText}</p> : null}<section className={styles.card}><DataTable columns={columns} rows={posts} rowKey={post => post.id} caption={`Posts awaiting approval, page ${listing.page} of ${listing.pages}`} emptyMessage="No posts are waiting for approval."/><PublishingPagination path="/publishing/approvals" page={listing.page} pages={listing.pages}/></section></>;
}
