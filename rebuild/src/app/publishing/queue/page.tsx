import { DataTable, type TableColumn } from "@/components";
import { requireViewer } from "@/server/context";
import { listPosts, type PostSummary } from "@/server/data";
import { PageHeading, PostMessage, PostTargets, formatDate } from "../publishing-ui";
import styles from "../publishing.module.css";

export default async function QueuePage() {
  const viewer = await requireViewer({ feature: 'publishing/queue' });
  const posts = (await listPosts(viewer.workspaceId)).filter(post => post.status === "scheduled").sort((a, b) => (a.scheduledAt?.getTime() ?? 0) - (b.scheduledAt?.getTime() ?? 0));
  const columns: TableColumn<PostSummary>[] = [
    { key: "time", label: "Scheduled for", render: post => <span className={styles.date}>{formatDate(post.scheduledAt, viewer.membership.workspace.timezone)}</span> },
    { key: "post", label: "Post", render: post => <PostMessage message={post.message}/> },
    { key: "channels", label: "Channels", render: post => <PostTargets post={post}/> },
  ];
  return <><PageHeading title="Queue" description="Scheduled posts waiting to publish, in publishing order." summary={`${posts.length} scheduled ${posts.length === 1 ? "post" : "posts"} · up to 100 recent`}/><section className={styles.card}><DataTable columns={columns} rows={posts} rowKey={post => post.id} caption="Scheduled publishing queue" emptyMessage="There are no scheduled posts in this workspace."/></section></>;
}
