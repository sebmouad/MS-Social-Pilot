import { DataTable, type TableColumn } from "@/components";
import { requireViewer } from "@/server/context";
import { listPosts, prisma } from "@/server/data";
import { PageHeading, PostMessage, PostTargets, StatusBadge, formatDate } from "../publishing-ui";
import styles from "../publishing.module.css";
import type { PostSummary } from "@/server/data";
import { CreateDraftForm, DraftRowActions } from "./PostActions";

const NOTICE_TEXT: Record<string, string> = {
  created: "Draft created.",
  updated: "Draft saved.",
  deleted: "Draft deleted.",
  failed: "The draft could not be changed. Check its status and your workspace access, then try again.",
};

export default async function PostsPage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  const viewer = await requireViewer({ feature: 'publishing/posts' });
  const posts = await listPosts(viewer.workspaceId);
  const { notice } = await searchParams;
  const noticeText = notice ? NOTICE_TEXT[notice] : undefined;
  const canManageDrafts = ["owner", "admin", "editor"].includes(viewer.membership.role);
  const canAuthorDrafts = canManageDrafts || viewer.membership.role === "contributor";
  const ownDraftIds = viewer.membership.role !== "contributor" ? new Set<string>() : new Set((await prisma.post.findMany({
    where: { workspaceId: viewer.workspaceId, authorId: viewer.user.id, status: "draft", publishedAt: null, targets: { none: {} } },
    select: { id: true },
  })).map(post => post.id));
  const columns: TableColumn<PostSummary>[] = [
    { key: "post", label: "Post", render: post => <PostMessage message={post.message}/> },
    { key: "channels", label: "Channels", render: post => <PostTargets post={post}/> },
    { key: "status", label: "Status", render: post => <StatusBadge status={post.status}/> },
    { key: "scheduled", label: "Publish time", render: post => <span className={styles.date}>{formatDate(post.scheduledAt ?? post.publishedAt, viewer.membership.workspace.timezone)}</span> },
  ];
  if (canAuthorDrafts) columns.push({ key: "actions", label: "Draft actions", render: post => post.status === "draft" && post.publishedAt === null && post.targets.length === 0 && (canManageDrafts || ownDraftIds.has(post.id)) ? <DraftRowActions postId={post.id} message={post.message}/> : <span className={styles.noActions}>Available for unconnected drafts</span> });
  return <>
    <PageHeading title="Posts" description="Review content and publishing status across your connected channels." summary={`${posts.length} ${posts.length === 1 ? "post" : "posts"} · up to 100 recent`}/>
    {noticeText ? <p className={notice === "failed" ? styles.errorNotice : styles.successNotice} role="status">{noticeText}</p> : null}
    {canAuthorDrafts ? <section className={`${styles.card} ${styles.createCard}`}><h2>Create a draft</h2><p>Drafts stay in this workspace until a later publishing flow is connected.</p><CreateDraftForm/></section> : null}
    <section className={styles.card}><DataTable columns={columns} rows={posts} rowKey={post => post.id} caption="Recent posts" emptyMessage="No posts have been created in this workspace yet."/></section>
  </>;
}
