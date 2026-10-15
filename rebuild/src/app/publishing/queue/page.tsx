import { DataTable, type TableColumn } from "@/components";
import { requireViewer } from "@/server/context";
import { listPostPage } from "@/server/data";
import { PageHeading, PostMessage, PostTargets, PublishingPagination, formatDate } from "../publishing-ui";
import styles from "../publishing.module.css";
import { cancelScheduledPostAction } from "../posts/actions";

export default async function QueuePage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const viewer = await requireViewer({ feature: 'publishing/queue', channelScoped: true });
  const allowedTargetIds = viewer.permissions.pageScope.all ? null : viewer.permissions.pageScope.ids;
  const { page: pageParam } = await searchParams;
  const requestedPage = pageParam && /^\d+$/.test(pageParam) ? Number(pageParam) : 1;
  const listing = await listPostPage(viewer.workspaceId, requestedPage, 50, allowedTargetIds, viewer.user.id, { status: 'scheduled', order: 'scheduled_asc' });
  const posts = listing.posts;
  const canManage = ["owner", "admin", "editor"].includes(viewer.membership.role);
  const columns: TableColumn<(typeof posts)[number]>[] = [
    { key: "time", label: "Scheduled for", render: post => <span className={styles.date}>{formatDate(post.scheduledAt, viewer.membership.workspace.timezone)}</span> },
    { key: "post", label: "Post", render: post => <PostMessage message={post.message}/> },
    { key: "channels", label: "Channels", render: post => <PostTargets post={post}/> },
    { key: "actions", label: "Actions", render: post => canManage || post.authorId === viewer.user.id ? <form action={cancelScheduledPostAction}><input type="hidden" name="postId" value={post.id}/><button className="ui-button ui-button--secondary ui-button--sm" type="submit">Cancel schedule</button></form> : <span className={styles.noActions}>Only the author or a workspace manager can cancel this item.</span> },
  ];
  return <><PageHeading title="Queue" description="Scheduled posts waiting to publish, in publishing order." summary={`${listing.total} scheduled ${listing.total === 1 ? "post" : "posts"} · page ${listing.page} of ${listing.pages}`}/><section className={styles.card}><DataTable columns={columns} rows={posts} rowKey={post => post.id} caption={`Scheduled publishing queue, page ${listing.page} of ${listing.pages}`} emptyMessage="There are no scheduled posts in this workspace."/><PublishingPagination path="/publishing/queue" page={listing.page} pages={listing.pages}/></section></>;
}
