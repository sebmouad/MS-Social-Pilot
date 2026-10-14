import { DataTable, type TableColumn } from "@/components";
import { requireViewer } from "@/server/context";
import { listPosts } from "@/server/data";
import { PageHeading, PostMessage, PostTargets, StatusBadge, formatDate } from "../publishing-ui";
import styles from "../publishing.module.css";
import type { PostSummary } from "@/server/data";

export default async function PostsPage() {
  const viewer = await requireViewer();
  const posts = await listPosts(viewer.workspaceId);
  const columns: TableColumn<PostSummary>[] = [
    { key: "post", label: "Post", render: post => <PostMessage message={post.message}/> },
    { key: "channels", label: "Channels", render: post => <PostTargets post={post}/> },
    { key: "status", label: "Status", render: post => <StatusBadge status={post.status}/> },
    { key: "scheduled", label: "Publish time", render: post => <span className={styles.date}>{formatDate(post.scheduledAt ?? post.publishedAt, viewer.membership.workspace.timezone)}</span> },
  ];
  return <><PageHeading title="Posts" description="Review content and publishing status across your connected channels." summary={`${posts.length} ${posts.length === 1 ? "post" : "posts"} · up to 100 recent`}/><section className={styles.card}><DataTable columns={columns} rows={posts} rowKey={post => post.id} caption="Recent posts" emptyMessage="No posts have been created in this workspace yet."/></section></>;
}
