import { DataTable, type TableColumn } from "@/components";
import { requireViewer } from "@/server/context";
import { getTargets, listPosts, prisma } from "@/server/data";
import { PageHeading, PostMessage, PostTargets, StatusBadge, formatDate } from "../publishing-ui";
import styles from "../publishing.module.css";
import { CsvImportForm, PostEditorForm, PostRowActions } from "./PostActions";
import { hasPlatformCapability } from "@/server/entitlements";

const NOTICE_TEXT: Record<string, string> = {
  created: "Post saved.",
  updated: "Post saved.",
  deleted: "Post deleted locally.",
  failed: "The publishing action could not be completed. Check permissions, connection status, and post state, then try again.",
  published: "Publishing completed.",
  "publish-review": "Some destinations still need review. Their claimed publishing records were kept to prevent duplicate posts.",
  synced: "Remote status sync completed.",
};

export default async function PostsPage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  const viewer = await requireViewer({ feature: 'publishing/posts' });
  const posts = await listPosts(viewer.workspaceId);
  const targetRows = await getTargets(viewer.workspaceId);
  const targetChoices = targetRows.map(target => ({ id: target.id, name: target.name, type: target.type, provider: target.socialAccount?.provider ?? null, canPublish: target.canPublish && !target.socialAccount?.invalidatedAt }));
  const extraPosts = await prisma.post.findMany({ where: { workspaceId: viewer.workspaceId, id: { in: posts.map(post => post.id) } }, select: { id: true, firstComment: true, authorId: true } });
  const byPost = new Map(extraPosts.map(post => [post.id, post]));
  const rows = posts.map(post => ({ ...post, firstComment: byPost.get(post.id)?.firstComment ?? null, authorId: byPost.get(post.id)?.authorId ?? '' }));
  const { notice } = await searchParams;
  const noticeText = notice ? NOTICE_TEXT[notice] ?? (notice.startsWith('imported-') ? `${notice.slice('imported-'.length)} posts imported as drafts.` : undefined) : undefined;
  const canManageDrafts = ["owner", "admin", "editor"].includes(viewer.membership.role);
  const canAuthorDrafts = canManageDrafts || viewer.membership.role === "contributor";
  const canPublish = hasPlatformCapability(viewer.entitlements, 'facebook');
  const columns: TableColumn<(typeof rows)[number]>[] = [
    { key: "post", label: "Post", render: post => <PostMessage message={post.message}/> },
    { key: "channels", label: "Channels", render: post => <PostTargets post={post}/> },
    { key: "status", label: "Status", render: post => <StatusBadge status={post.status}/> },
    { key: "scheduled", label: "Publish time", render: post => <span className={styles.date}>{formatDate(post.scheduledAt ?? post.publishedAt, viewer.membership.workspace.timezone)}</span> },
  ];
  if (canAuthorDrafts) columns.push({ key: "actions", label: "Post actions", render: post => {
    const canEdit = canManageDrafts || post.authorId === viewer.user.id;
    return canEdit ? <PostRowActions post={post} targets={targetChoices} canEdit={canEdit} canPublish={canPublish}/> : <span className={styles.noActions}>Post actions are limited to its author and workspace managers.</span>;
  } });
  return <>
    <PageHeading title="Posts" description="Create posts, choose destinations, publish through Facebook, and review delivery status." summary={`${posts.length} ${posts.length === 1 ? "post" : "posts"} · up to 100 recent`}/>
    {noticeText ? <p className={notice === "failed" ? styles.errorNotice : styles.successNotice} role="status">{noticeText}</p> : null}
    {canAuthorDrafts ? <section className={`${styles.card} ${styles.createCard}`}><h2>Create a post</h2><p>Choose an enabled Facebook Page now or save this as a local draft.</p><PostEditorForm targets={targetChoices}/></section> : null}
    {canManageDrafts ? <section className={`${styles.card} ${styles.createCard}`}><h2>Import a batch</h2><p>Upload a CSV of posts and optional first comments.</p><CsvImportForm targets={targetChoices}/></section> : null}
    <section className={styles.card}><DataTable columns={columns} rows={rows} rowKey={post => post.id} caption="Recent posts" emptyMessage="No posts have been created in this workspace yet."/></section>
  </>;
}
