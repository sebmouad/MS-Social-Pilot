import { DataTable, type TableColumn } from "@/components";
import { requireViewer } from "@/server/context";
import { listPosts, type PostSummary } from "@/server/data";
import { PageHeading, PostMessage, PostTargets, formatDate } from "../publishing-ui";
import styles from "../publishing.module.css";
import { prisma } from "@/server/data";
import { cancelScheduledPostAction } from "../posts/actions";

export default async function QueuePage() {
  const viewer = await requireViewer({ feature: 'publishing/queue', channelScoped: true });
  const allowedTargetIds = viewer.permissions.pageScope.all ? null : viewer.permissions.pageScope.ids;
  const rawPosts = (await listPosts(viewer.workspaceId)).filter(post => post.status === "scheduled");
  const posts = (allowedTargetIds === null ? rawPosts : rawPosts.filter(post => post.targets.every(item => allowedTargetIds.includes(item.target.id)))).sort((a, b) => (a.scheduledAt?.getTime() ?? 0) - (b.scheduledAt?.getTime() ?? 0));
  const authors = posts.length ? await prisma.post.findMany({ where: { id: { in: posts.map(post => post.id) }, workspaceId: viewer.workspaceId }, select: { id: true, authorId: true } }) : [];
  const authorByPost = new Map(authors.map(post => [post.id, post.authorId]));
  const canManage = ["owner", "admin", "editor"].includes(viewer.membership.role);
  const columns: TableColumn<PostSummary>[] = [
    { key: "time", label: "Scheduled for", render: post => <span className={styles.date}>{formatDate(post.scheduledAt, viewer.membership.workspace.timezone)}</span> },
    { key: "post", label: "Post", render: post => <PostMessage message={post.message}/> },
    { key: "channels", label: "Channels", render: post => <PostTargets post={post}/> },
    { key: "actions", label: "Actions", render: post => canManage || authorByPost.get(post.id) === viewer.user.id ? <form action={cancelScheduledPostAction}><input type="hidden" name="postId" value={post.id}/><button className="ui-button ui-button--secondary ui-button--sm" type="submit">Cancel schedule</button></form> : <span className={styles.noActions}>Only the author or a workspace manager can cancel this item.</span> },
  ];
  return <><PageHeading title="Queue" description="Scheduled posts waiting to publish, in publishing order." summary={`${posts.length} scheduled ${posts.length === 1 ? "post" : "posts"} · up to 100 recent`}/><section className={styles.card}><DataTable columns={columns} rows={posts} rowKey={post => post.id} caption="Scheduled publishing queue" emptyMessage="There are no scheduled posts in this workspace."/></section></>;
}
