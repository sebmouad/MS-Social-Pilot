import { DataTable, type TableColumn } from "@/components";
import { requireViewer } from "@/server/context";
import { listPosts, type PostSummary } from "@/server/data";
import { PageHeading, PostMessage, PostTargets, formatDate } from "../publishing-ui";
import styles from "../publishing.module.css";
import { reviewPostAction } from "../posts/actions";

export default async function ApprovalsPage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  const viewer = await requireViewer({ feature: 'publishing/approvals', channelScoped: true });
  const allowedTargetIds = viewer.permissions.pageScope.all ? null : viewer.permissions.pageScope.ids;
  const allPosts = (await listPosts(viewer.workspaceId)).filter(post => post.status === "pending_approval");
  const posts = (allowedTargetIds === null ? allPosts : allPosts.filter(post => post.targets.every(item => allowedTargetIds.includes(item.target.id)))).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const { notice } = await searchParams;
  const columns: TableColumn<PostSummary>[] = [
    { key: "post", label: "Post", render: post => <PostMessage message={post.message}/> },
    { key: "channels", label: "Channels", render: post => <PostTargets post={post}/> },
    { key: "submitted", label: "Created", render: post => <span className={styles.date}>{formatDate(post.createdAt, viewer.membership.workspace.timezone)}</span> },
  ];
  if (viewer.permissions.features['publishing/approvals'].write) columns.push({ key: "review", label: "Review", render: post => <div className={styles.rowActions}>
    <form action={reviewPostAction}><input type="hidden" name="postId" value={post.id}/><input type="hidden" name="decision" value="approve"/><button className="ui-button ui-button--primary ui-button--sm" type="submit">Approve</button></form>
    <form action={reviewPostAction}><input type="hidden" name="postId" value={post.id}/><input type="hidden" name="decision" value="reject"/><button className="ui-button ui-button--secondary ui-button--sm" type="submit">Reject</button></form>
  </div> });
  const noticeText = notice === 'approved' ? 'Post approved and returned to drafts.' : notice === 'rejected' ? 'Post rejected.' : notice === 'failed' ? 'The review could not be completed. Check the post state and your permissions.' : undefined;
  return <><PageHeading title="Approvals" description="Posts currently marked as awaiting approval." summary={`${posts.length} awaiting ${posts.length === 1 ? "review" : "reviews"} · up to 100 recent`} />{noticeText ? <p className={notice === 'failed' ? styles.errorNotice : styles.successNotice} role="status">{noticeText}</p> : null}<section className={styles.card}><DataTable columns={columns} rows={posts} rowKey={post => post.id} caption="Posts awaiting approval" emptyMessage="No posts are waiting for approval."/></section></>;
}
