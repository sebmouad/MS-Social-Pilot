import { DataTable, type TableColumn } from "@/components";
import { requireViewer } from "@/server/context";
import { listPosts, type PostSummary } from "@/server/data";
import { PageHeading, PostMessage, PostTargets, formatDate } from "../publishing-ui";
import styles from "../publishing.module.css";

export default async function ApprovalsPage() {
  const viewer = await requireViewer();
  const posts = (await listPosts(viewer.workspaceId)).filter(post => post.status === "pending_approval").sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const columns: TableColumn<PostSummary>[] = [
    { key: "post", label: "Post", render: post => <PostMessage message={post.message}/> },
    { key: "channels", label: "Channels", render: post => <PostTargets post={post}/> },
    { key: "submitted", label: "Created", render: post => <span className={styles.date}>{formatDate(post.createdAt, viewer.membership.workspace.timezone)}</span> },
  ];
  return <><PageHeading title="Approvals" description="Posts currently marked as awaiting approval." summary={`${posts.length} awaiting ${posts.length === 1 ? "review" : "reviews"} · up to 100 recent`} /><section className={styles.card}><DataTable columns={columns} rows={posts} rowKey={post => post.id} caption="Posts awaiting approval" emptyMessage="No posts are waiting for approval."/></section></>;
}
