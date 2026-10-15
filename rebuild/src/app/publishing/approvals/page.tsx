import { StatusChip } from "@/components";
import { requireViewer } from "@/server/context";
import { getTargets, listPostPage } from "@/server/data";
import { PageHeading, PublishingPagination, formatDate } from "../publishing-ui";
import { EmptyState, RowChannels, WorkList, WorkRow, workStyles as styles } from "../worklist";
import publishing from "../publishing.module.css";
import { reviewWithNoteAction } from "./actions";

const NOTICES: Record<string, { text: string; error?: boolean }> = {
  approved: { text: "Post approved and returned to drafts." },
  rejected: { text: "Post rejected." },
  failed: { text: "The review could not be completed. Check the post state and your permissions.", error: true },
  "failed-access": { text: "You do not have permission to review this post.", error: true },
  "failed-note": { text: "Keep the note to 500 characters or fewer.", error: true },
};

export default async function ApprovalsPage({ searchParams }: { searchParams: Promise<{ notice?: string; page?: string }> }) {
  const viewer = await requireViewer({ feature: "publishing/approvals", channelScoped: true });
  const allowedTargetIds = viewer.permissions.pageScope.all ? null : viewer.permissions.pageScope.ids;
  const { notice, page: pageParam } = await searchParams;
  const requestedPage = pageParam && /^\d+$/.test(pageParam) ? Number(pageParam) : 1;
  const [listing, targets] = await Promise.all([
    listPostPage(viewer.workspaceId, requestedPage, 50, allowedTargetIds, viewer.user.id, { status: "pending_approval", order: "created_asc" }),
    getTargets(viewer.workspaceId),
  ]);
  const providers = new Map(targets.map(target => [target.id, target.socialAccount?.provider ?? null]));
  const canReview = viewer.permissions.features["publishing/approvals"].write;
  const timeZone = viewer.membership.workspace.timezone;
  const feedback = notice ? NOTICES[notice] : undefined;

  return <>
    <PageHeading title="Approvals" description="Posts waiting for someone to approve or reject them, oldest first." summary={`${listing.total} awaiting ${listing.total === 1 ? "review" : "reviews"} · page ${listing.page} of ${listing.pages}`} />
    {feedback ? <p className={feedback.error ? publishing.errorNotice : publishing.successNotice} role={feedback.error ? "alert" : "status"}>{feedback.text}</p> : null}
    {listing.total === 0 ? <EmptyState title="No posts are waiting for approval">When a teammate submits a draft for review, it appears here so you can approve or reject it.</EmptyState> : <>
      <WorkList label={`Posts awaiting approval, page ${listing.page} of ${listing.pages}`}>{listing.posts.map(post => <WorkRow key={post.id} chip={<StatusChip status={post.status} />}
        when={<>Created <time dateTime={post.createdAt.toISOString()}>{formatDate(post.createdAt, timeZone)}</time></>}
        actions={canReview ? <form className={styles.review} action={reviewWithNoteAction}>
          <input type="hidden" name="postId" value={post.id} />
          <label htmlFor={`note-${post.id}`}>Note (optional)</label>
          <textarea id={`note-${post.id}`} name="note" maxLength={500} rows={2} placeholder="Why you approved or rejected it" />
          <div className={styles.reviewButtons}>
            <button className="ui-button ui-button--primary ui-button--sm" type="submit" name="decision" value="approve">Approve</button>
            <button className="ui-button ui-button--secondary ui-button--sm" type="submit" name="decision" value="reject">Reject</button>
          </div>
          <p className={styles.help}>Approving returns the post to drafts. Your note is saved with the decision.</p>
        </form> : <p className={styles.help}>You can view this post but not review it.</p>}>
        <p className={styles.text}>{post.message.trim() || "No text included"}</p>
        <RowChannels targets={post.targets} providers={providers} />
      </WorkRow>)}</WorkList>
      <PublishingPagination path="/publishing/approvals" page={listing.page} pages={listing.pages} />
    </>}
  </>;
}
