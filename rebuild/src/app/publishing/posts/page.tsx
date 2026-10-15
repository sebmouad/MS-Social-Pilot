import { EmptyState } from "@/components";
import { requireViewer } from "@/server/context";
import { listPostPage } from "@/server/data";
import { canAccessFeature } from "@/server/permissions";
import { canUseFeature } from "@/server/entitlements";
import { PageHeading, NewPostLink, PublishingPagination } from "../publishing-ui";
import styles from "../publishing.module.css";
import { PostList, type ListPost } from "./PostList";
import { loadChannelChoices, moduleLabels } from "../channels";
import { PostStatus } from '../../../../generated/client';

export const metadata = { title: "Posts" };

const NOTICE_TEXT: Record<string, string> = {
  created: "Draft saved.",
  updated: "Changes saved.",
  deleted: "Post deleted.",
  failed: "The publishing action could not be completed. Check permissions, connection status, and post state, then try again.",
  'failed-import': "The CSV could not be imported. Check its header, row format, and file size, then try again.",
  'failed-image': "The image could not be used for every selected destination. Check its type and size, or choose another image.",
  'failed-remote-delete': "Deleting the live post could not be confirmed. Nothing was deleted here, and delivery history was kept. Reconnect the channel or try again.",
  'failed-access': "Your role or channel access does not permit this action.",
  'failed-state': "This post is no longer eligible for that action. Refresh the page and review its current status.",
  published: "Published.",
  submitted: "Submitted for approval.",
  scheduled: "Post scheduled. It is in the queue.",
  cancelled: "Schedule cancelled. The post is back in drafts.",
  "publish-review": "Some channels still need review. Their publishing records were kept to prevent duplicate posts.",
  synced: "Status synced with the platform.",
};

export default async function PostsPage({ searchParams }: { searchParams: Promise<{ notice?: string; page?: string; status?: string; channel?: string }> }) {
  const viewer = await requireViewer({ feature: 'publishing/posts', channelScoped: true });
  const { notice, page: pageParam, status, channel } = await searchParams;
  const allowedTargetIds = viewer.permissions.pageScope.all ? null : viewer.permissions.pageScope.ids;
  const requestedPage = pageParam && /^\d+$/.test(pageParam) ? Number(pageParam) : 1;
  const selectedStatus = Object.values(PostStatus).find(value => value === status);
  const selectedChannel = channel || undefined;
  const [listing, channels] = await Promise.all([
    listPostPage(viewer.workspaceId, requestedPage, 50, allowedTargetIds, viewer.user.id, { status: selectedStatus, channelId: selectedChannel }),
    loadChannelChoices(viewer),
  ]);
  const posts = listing.posts.map(post => ({ ...post, media: post.media as Array<{ kind: string; url: string }> })) as ListPost[];
  const noticeText = notice ? NOTICE_TEXT[notice] ?? (notice.startsWith('imported-') ? `${notice.slice('imported-'.length)} posts imported as drafts.` : undefined) : undefined;
  const failed = Boolean(notice?.startsWith('failed'));
  const role = viewer.membership.role;
  const canCompose = canUseFeature(viewer.entitlements, 'publishing/compose') && canAccessFeature(viewer.permissions, 'publishing/compose', 'write');
  const filtered = Boolean(selectedStatus || selectedChannel);
  const query = new URLSearchParams();
  if (selectedStatus) query.set('status', selectedStatus);
  if (selectedChannel) query.set('channel', selectedChannel);
  return <>
    <PageHeading title="Posts" description="Everything written for this workspace, with where it goes and when." summary={listing.total ? `${listing.total} ${listing.total === 1 ? "post" : "posts"}${listing.pages > 1 ? ` · page ${listing.page} of ${listing.pages}` : ""}` : undefined} action={canCompose ? <NewPostLink /> : undefined} />
    {noticeText ? <p className={failed ? styles.errorNotice : styles.successNotice} role={failed ? 'alert' : 'status'}>{noticeText}</p> : null}
    {posts.length ? <section aria-label="Posts">
      <PostList posts={posts} caption={`Posts, page ${listing.page} of ${listing.pages}`} context={{
        timeZone: viewer.membership.workspace.timezone, userId: viewer.user.id,
        isManager: ["owner", "admin", "editor"].includes(role), isAuthor: ["owner", "admin", "editor", "contributor"].includes(role) && canAccessFeature(viewer.permissions, 'publishing/posts', 'write'),
        canPublish: channels.some(item => item.canPublish), labels: moduleLabels(),
      }} />
      <PublishingPagination path="/publishing/posts" page={listing.page} pages={listing.pages} query={query.toString()} />
    </section> : filtered
      ? <EmptyState title="No posts match these filters" action={<a className="ui-button ui-button--secondary" href="/publishing/posts">Clear filters</a>}>Try a different status or channel. Posts appear here as soon as they match.</EmptyState>
      : <EmptyState title="No posts yet" action={canCompose ? <NewPostLink label="Write your first post" /> : undefined}>Posts you write, schedule, or import appear here with their channels, status, and publish time.</EmptyState>}
  </>;
}
