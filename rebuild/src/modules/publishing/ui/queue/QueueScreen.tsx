import { SidebarDock } from '@/components/SidebarDock';
import { PostPreview } from "@/components/PostPreview";
import { requireViewer } from "@/server/context";
import { readPublishingPostPage } from "@/modules/publishing/server/read";
import { addDaysToKey, workspaceDateKey } from "@/lib/calendar-dates";
import { PageHeading, PublishingPagination } from "@/modules/publishing/ui/publishing-ui";
import { EmptyState } from "@/modules/publishing/ui/worklist";
import workflow from "@/modules/publishing/ui/workflow.module.css";
import { CancelScheduleButton } from "@/modules/publishing/ui/WorkflowSubmitButtons";
import { canCancelQueuedPost } from "@/modules/publishing/ui/workflow-access";
import { cancelScheduledPostAction } from "@/modules/publishing/ui/posts/actions";

export default async function QueuePage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const viewer = await requireViewer({ feature: "publishing/queue", channelScoped: true });
  const timeZone = viewer.membership.workspace.timezone;
  const { page: pageParam } = await searchParams;
  const requestedPage = pageParam && /^[1-9]\d*$/.test(pageParam) && Number.isSafeInteger(Number(pageParam)) ? Number(pageParam) : 1;
  const listing = await readPublishingPostPage({ userId: viewer.user.id, workspaceId: viewer.workspaceId }, { page: requestedPage, status: "scheduled", order: "scheduled_asc" }, "publishing/queue");
  const now = new Date();
  const today = workspaceDateKey(now, timeZone);
  const tomorrow = addDaysToKey(today, 1);

  const groups = new Map<string, typeof listing.posts>();
  for (const post of listing.posts) {
    const key = post.scheduledAt ? workspaceDateKey(post.scheduledAt, timeZone) : "unscheduled";
    groups.set(key, [...(groups.get(key) ?? []), post]);
  }
  const dayHeading = (key: string) => key === "unscheduled" ? "No time set" : `${key === today ? "Today · " : key === tomorrow ? "Tomorrow · " : ""}${new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" }).format(new Date(`${key}T12:00:00Z`))}`;
  return <>
    <SidebarDock><a className="text-link" href="/publishing/collaboration?view=queue">Queue times</a></SidebarDock>
    <PageHeading title="Queue" description={`Scheduled posts waiting to publish, in publishing order. Times are in ${timeZone.replaceAll("_", " ")}.`} summary={`${listing.total} scheduled ${listing.total === 1 ? "post" : "posts"} · page ${listing.page} of ${listing.pages}`} />
    {listing.total === 0 ? <EmptyState title="Nothing is scheduled">Posts you schedule from the composer wait here until their publishing time. <a className="text-link" href="/publishing/compose">Create a post</a> or open the <a className="text-link" href="/publishing/calendar">calendar</a> to plan one.</EmptyState> : <>
      {[...groups.entries()].map(([key, posts]) => <section key={key} className={workflow.group} aria-labelledby={`queue-${key}`}>
        <h2 id={`queue-${key}`} className={workflow.groupHeading}>{dayHeading(key)}</h2>
        <ul className={workflow.items} aria-label={dayHeading(key)}>{posts.map(post => {
          const due = post.scheduledAt !== null && post.scheduledAt <= now;
          const mayCancel = canCancelQueuedPost({ canWritePosts: viewer.permissions.features["publishing/posts"].write, role: viewer.membership.role, userId: viewer.user.id, authorId: post.authorId });
          const actions = <div className={workflow.actions}>
            {mayCancel ? <><form noValidate action={cancelScheduledPostAction}><input type="hidden" name="postId" value={post.id} /><CancelScheduleButton /></form><p className={workflow.help}>Returns the post to drafts.</p></>
              : <p className={workflow.help}>{viewer.permissions.features["publishing/posts"].write ? "Only the author or a workspace manager can cancel this item." : "You can view this post but cannot change it."}</p>}
            {due ? <p className={workflow.help} role="status">Due; publishes on the next run.</p> : null}
          </div>;
          return <li key={post.id} className={workflow.item}><PostPreview post={post} authorName={post.authorId === viewer.user.id ? viewer.user.name : "Workspace member"} timeZone={timeZone} actions={actions} /></li>;
        })}</ul>
      </section>)}
      <PublishingPagination path="/publishing/queue" page={listing.page} pages={listing.pages} />
    </>}
  </>;
}
