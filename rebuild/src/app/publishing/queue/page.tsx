import { EmptyState } from "@/components";
import { requireViewer } from "@/server/context";
import { listPostPage } from "@/server/data";
import { canAccessFeature } from "@/server/permissions";
import { canUseFeature } from "@/server/entitlements";
import { PageHeading, NewPostLink, PublishingPagination } from "../publishing-ui";
import { PostList, type ListPost } from "../posts/PostList";
import { moduleLabels } from "../channels";

export const metadata = { title: "Queue" };

export default async function QueuePage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const viewer = await requireViewer({ feature: 'publishing/queue', channelScoped: true });
  const allowedTargetIds = viewer.permissions.pageScope.all ? null : viewer.permissions.pageScope.ids;
  const { page: pageParam } = await searchParams;
  const requestedPage = pageParam && /^\d+$/.test(pageParam) ? Number(pageParam) : 1;
  const listing = await listPostPage(viewer.workspaceId, requestedPage, 50, allowedTargetIds, viewer.user.id, { status: 'scheduled', order: 'scheduled_asc' });
  const posts = listing.posts.map(post => ({ ...post, media: post.media as Array<{ kind: string; url: string }> })) as ListPost[];
  const canCompose = canUseFeature(viewer.entitlements, 'publishing/compose') && canAccessFeature(viewer.permissions, 'publishing/compose', 'write');
  return <>
    <PageHeading title="Queue" description="Scheduled posts waiting to publish, in publishing order." summary={listing.total ? `${listing.total} scheduled${listing.pages > 1 ? ` · page ${listing.page} of ${listing.pages}` : ""}` : undefined} action={canCompose ? <NewPostLink /> : undefined} />
    {posts.length ? <section aria-label="Scheduled posts">
      <PostList posts={posts} caption={`Scheduled publishing queue, page ${listing.page} of ${listing.pages}`} context={{
        timeZone: viewer.membership.workspace.timezone, userId: viewer.user.id, mode: "queue",
        isManager: ["owner", "admin", "editor"].includes(viewer.membership.role), isAuthor: canAccessFeature(viewer.permissions, 'publishing/queue', 'write'),
        canPublish: false, labels: moduleLabels(),
      }} />
      <PublishingPagination path="/publishing/queue" page={listing.page} pages={listing.pages} />
    </section> : <EmptyState title="Nothing is scheduled" action={canCompose ? <NewPostLink label="Schedule a post" /> : undefined}>Posts you schedule wait here, in publishing order, until their time comes.</EmptyState>}
  </>;
}
