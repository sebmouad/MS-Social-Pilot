import { PostPreview } from "@/components/PostPreview";
import { requireViewer } from "@/server/context";
import { listPostPage } from "@/server/data";
import { PageHeading, PublishingPagination } from "../publishing-ui";
import { EmptyState } from "../worklist";
import workflow from "../workflow.module.css";
import publishing from "../publishing.module.css";
import { reviewWithNoteAction } from "./actions";
import { ReviewButtons } from "../WorkflowSubmitButtons";

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
  const listing = await listPostPage(viewer.workspaceId, requestedPage, 50, allowedTargetIds, viewer.user.id, { status: "pending_approval", order: "created_asc" });
  const canReview = viewer.permissions.features["publishing/approvals"].write;
  const timeZone = viewer.membership.workspace.timezone;
  const feedback = notice ? NOTICES[notice] : undefined;

  return <>
    <PageHeading title="Approvals" description="Posts waiting for someone to approve or reject them, oldest first." summary={`${listing.total} awaiting ${listing.total === 1 ? "review" : "reviews"} · page ${listing.page} of ${listing.pages}`} />
    {feedback ? <p className={feedback.error ? publishing.errorNotice : publishing.successNotice} role={feedback.error ? "alert" : "status"}>{feedback.text}</p> : null}
    {listing.total === 0 ? <EmptyState title="No posts are waiting for approval">When a teammate submits a draft for review, it appears here so you can approve or reject it.</EmptyState> : <>
      <ul className={workflow.items} aria-label={`Posts awaiting approval, page ${listing.page} of ${listing.pages}`}>{listing.posts.map(post => {
        const actions = canReview ? <div className={workflow.actions}>
          <form className={workflow.form} action={reviewWithNoteAction}>
            <input type="hidden" name="postId" value={post.id} />
            <label htmlFor={`note-${post.id}`}>Review note (optional)</label>
            <textarea id={`note-${post.id}`} name="note" maxLength={500} rows={2} aria-describedby={`note-help-${post.id}`} placeholder="Why you approved or rejected it" />
            <ReviewButtons />
            <p className={workflow.help} id={`note-help-${post.id}`}>Approving returns the post to drafts. Your note is saved with the decision.</p>
          </form>
        </div> : <div className={workflow.actions}><p className={workflow.help}>You can view this post but not review it.</p></div>;
        return <li className={workflow.item} key={post.id}><PostPreview post={post} authorName={post.authorId === viewer.user.id ? viewer.user.name : "Workspace member"} timeZone={timeZone} actions={actions} /></li>;
      })}</ul>
      <PublishingPagination path="/publishing/approvals" page={listing.page} pages={listing.pages} />
    </>}
  </>;
}
