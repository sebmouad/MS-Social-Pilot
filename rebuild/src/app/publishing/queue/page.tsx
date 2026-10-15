import { StatusChip } from "@/components";
import { requireViewer } from "@/server/context";
import { getTargets, listPostPage } from "@/server/data";
import { addDaysToKey, workspaceDateKey } from "@/lib/calendar-dates";
import { PageHeading, PublishingPagination } from "../publishing-ui";
import { EmptyState, RowChannels, WorkList, WorkRow, workStyles as styles } from "../worklist";
import { cancelScheduledPostAction } from "../posts/actions";

const MANAGERS = new Set(["owner", "admin", "editor"]);

export default async function QueuePage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const viewer = await requireViewer({ feature: "publishing/queue", channelScoped: true });
  const timeZone = viewer.membership.workspace.timezone;
  const allowedTargetIds = viewer.permissions.pageScope.all ? null : viewer.permissions.pageScope.ids;
  const { page: pageParam } = await searchParams;
  const requestedPage = pageParam && /^\d+$/.test(pageParam) ? Number(pageParam) : 1;
  const [listing, targets] = await Promise.all([
    listPostPage(viewer.workspaceId, requestedPage, 50, allowedTargetIds, viewer.user.id, { status: "scheduled", order: "scheduled_asc" }),
    getTargets(viewer.workspaceId),
  ]);
  const providers = new Map(targets.map(target => [target.id, target.socialAccount?.provider ?? null]));
  const canManage = MANAGERS.has(viewer.membership.role);
  const now = new Date();
  const today = workspaceDateKey(now, timeZone);
  const tomorrow = addDaysToKey(today, 1);

  const groups = new Map<string, typeof listing.posts>();
  for (const post of listing.posts) {
    const key = post.scheduledAt ? workspaceDateKey(post.scheduledAt, timeZone) : "unscheduled";
    groups.set(key, [...(groups.get(key) ?? []), post]);
  }
  const dayHeading = (key: string) => key === "unscheduled" ? "No time set" : `${key === today ? "Today · " : key === tomorrow ? "Tomorrow · " : ""}${new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" }).format(new Date(`${key}T12:00:00Z`))}`;
  const clock = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone });

  return <>
    <PageHeading title="Queue" description={`Scheduled posts waiting to publish, in publishing order. Times are in ${timeZone.replaceAll("_", " ")}.`} summary={`${listing.total} scheduled ${listing.total === 1 ? "post" : "posts"} · page ${listing.page} of ${listing.pages}`} />
    {listing.total === 0 ? <EmptyState title="Nothing is scheduled">Posts you schedule from the composer wait here until their publishing time. <a className="text-link" href="/publishing/compose">Create a post</a> or open the <a className="text-link" href="/publishing/calendar">calendar</a> to plan one.</EmptyState> : <>
      {[...groups.entries()].map(([key, posts]) => <section key={key} className={styles.group} aria-labelledby={`queue-${key}`}>
        <h2 id={`queue-${key}`} className={styles.groupHead}>{dayHeading(key)}</h2>
        <WorkList label={dayHeading(key)}>{posts.map(post => {
          const due = post.scheduledAt !== null && post.scheduledAt <= now;
          const mayCancel = canManage || post.authorId === viewer.user.id;
          return <WorkRow key={post.id} chip={<StatusChip status={post.status} />}
            when={post.scheduledAt ? <><time dateTime={post.scheduledAt.toISOString()}>{clock.format(post.scheduledAt)}</time>{due ? <span className={styles.due}> · Due, publishes on the next run</span> : null}</> : "No time set"}
            actions={mayCancel
              ? <><form action={cancelScheduledPostAction}><input type="hidden" name="postId" value={post.id} /><button className="ui-button ui-button--secondary ui-button--sm" type="submit">Cancel schedule</button></form><p className={styles.help}>Returns the post to drafts.</p></>
              : <p className={styles.help}>Only the author or a workspace manager can cancel this item.</p>}>
            <p className={styles.text}>{post.message.trim() || "No text included"}</p>
            <RowChannels targets={post.targets} providers={providers} />
          </WorkRow>;
        })}</WorkList>
      </section>)}
      <PublishingPagination path="/publishing/queue" page={listing.page} pages={listing.pages} />
    </>}
  </>;
}
