import { IconChecklist } from '@tabler/icons-react';
import { requireViewer } from "@/server/context";
import { readPublishingPostPage } from "@/modules/publishing/server/read";
import { PageHeading, PublishingPagination, formatDate } from "@/modules/publishing/ui/publishing-ui";
import { EmptyPanel } from "../kit/kit";
import { kitCopy, type KitLocale } from "../kit/copy";
import { pageLocale } from "../kit/locale";
import publishing from "@/modules/publishing/ui/publishing.module.css";
import { reviewWithNoteAction } from "./actions";
import { ApprovalsTable } from "./ApprovalsTable";

const NOTICES: Record<KitLocale, Record<string, { text: string; error?: boolean }>> = {
  en: {
    approved: { text: "Post approved and returned to drafts." },
    rejected: { text: "Post rejected." },
    failed: { text: "The review could not be completed. Check the post state and your permissions.", error: true },
    "failed-access": { text: "You do not have permission to review this post.", error: true },
    "failed-note": { text: "Keep the note to 500 characters or fewer.", error: true },
  },
  fr: {
    approved: { text: "Publication approuvée et remise en brouillon." },
    rejected: { text: "Publication refusée." },
    failed: { text: "La validation n’a pas pu être terminée. Vérifiez l’état de la publication et vos droits.", error: true },
    "failed-access": { text: "Vous n’avez pas le droit de valider cette publication.", error: true },
    "failed-note": { text: "La note doit faire 500 caractères ou moins.", error: true },
  },
};

export default async function ApprovalsPage({ searchParams }: { searchParams: Promise<{ notice?: string; page?: string }> }) {
  const viewer = await requireViewer({ feature: "publishing/approvals", channelScoped: true });
  const { notice, page: pageParam } = await searchParams;
  const locale = await pageLocale();
  const copy = kitCopy[locale];
  const requestedPage = pageParam && /^[1-9]\d*$/.test(pageParam) && Number.isSafeInteger(Number(pageParam)) ? Number(pageParam) : 1;
  const listing = await readPublishingPostPage({ userId: viewer.user.id, workspaceId: viewer.workspaceId }, { page: requestedPage, status: "pending_approval", order: "created_asc" }, "publishing/approvals");
  const canReview = viewer.permissions.features["publishing/approvals"].write;
  const timeZone = viewer.membership.workspace.timezone;
  const feedback = notice ? NOTICES[locale][notice] : undefined;

  return <>
    <PageHeading href="/publishing/approvals" title={copy.approvalsTitle} description={copy.approvalsDescription} summary={copy.approvalsSummary(listing.total, listing.page, listing.pages)} />
    {feedback ? <p className={feedback.error ? publishing.errorNotice : publishing.successNotice} role={feedback.error ? "alert" : "status"}>{feedback.text}</p> : null}
    {listing.total === 0
      ? <EmptyPanel icon={<IconChecklist size={26} aria-hidden="true" />} title={copy.approvalsEmptyTitle} action={<a className="ui-button ui-button--secondary" href="/publishing/posts?status=draft">{copy.approvalsEmptyAction}</a>}>{copy.approvalsEmptyBody}</EmptyPanel>
      : <>
        <ApprovalsTable rows={listing.posts.map(post => ({ ...post, media: post.media as Array<{ kind: string; url: string; altText?: string }>, authorName: post.authorId === viewer.user.id ? viewer.user.name : copy.approvalsMember, whenLabel: formatDate(post.createdAt, timeZone, true, locale) }))}
          caption={copy.approvalsList(listing.page, listing.pages)} locale={locale} timeZone={timeZone} canReview={canReview} reviewAction={reviewWithNoteAction} />
        <PublishingPagination path="/publishing/approvals" page={listing.page} pages={listing.pages} locale={locale} />
      </>}
  </>;
}
