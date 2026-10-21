import { approvalNotice } from '../posts/notices';
import { loadPublishingCopy, loadPublishingNoticeCopy } from '../../server/customer-copy';
import { PublishingCopyProvider } from '../kit/CopyProvider';
import { loadPublishingActionCopy } from '../../server/action-copy';
import { PublishingActionCopyProvider } from '../WorkflowSubmitButtons';
import { IconChecklist } from '@tabler/icons-react';
import { requireViewer } from "@/server/context";
import { readPublishingPostPage } from "@/modules/publishing/server/read";
import { PageHeading, PublishingPagination, formatDate } from "@/modules/publishing/ui/publishing-ui";
import { EmptyPanel } from "../kit/kit";
import { type KitLocale } from "../kit/copy";
import { pageLocale } from "../kit/locale";
import publishing from "@/modules/publishing/ui/publishing.module.css";
import { reviewWithNoteAction } from "./actions";
import { ApprovalsTable } from "./ApprovalsTable";

export default async function ApprovalsPage({ searchParams }: { searchParams: Promise<{ notice?: string; page?: string }> }) {
  const viewer = await requireViewer({ feature: "publishing/approvals", channelScoped: true });
  const { notice, page: pageParam } = await searchParams;
  const locale = await pageLocale();
  const { catalog, copy: localizedCopy } = await loadPublishingCopy();
  const noticeCatalog = await loadPublishingNoticeCopy();
  const actionCatalog = await loadPublishingActionCopy();
  const copy = localizedCopy[locale];
  const requestedPage = pageParam && /^[1-9]\d*$/.test(pageParam) && Number.isSafeInteger(Number(pageParam)) ? Number(pageParam) : 1;
  const listing = await readPublishingPostPage({ userId: viewer.user.id, workspaceId: viewer.workspaceId }, { page: requestedPage, status: "pending_approval", order: "created_asc" }, "publishing/approvals");
  const canReview = viewer.permissions.features["publishing/approvals"].write;
  const timeZone = viewer.membership.workspace.timezone;
  const feedback = approvalNotice(notice, locale, noticeCatalog);

  return <PublishingCopyProvider catalog={catalog} locale={locale}><PublishingActionCopyProvider catalog={actionCatalog} locale={locale}>
    <PageHeading href="/publishing/approvals" title={copy.approvalsTitle} description={copy.approvalsDescription} summary={copy.approvalsSummary(listing.total, listing.page, listing.pages)} />
    {feedback ? <p className={feedback.error ? publishing.errorNotice : publishing.successNotice} role={feedback.error ? "alert" : "status"}>{feedback.text}</p> : null}
    {listing.total === 0
      ? <EmptyPanel icon={<IconChecklist size={26} aria-hidden="true" />} title={copy.approvalsEmptyTitle} action={<a className="ui-button ui-button--secondary" href="/publishing/posts?status=draft">{copy.approvalsEmptyAction}</a>}>{copy.approvalsEmptyBody}</EmptyPanel>
      : <>
        <ApprovalsTable rows={listing.posts.map(post => ({ ...post, media: post.media as Array<{ kind: string; url: string; altText?: string }>, authorName: post.authorId === viewer.user.id ? viewer.user.name : copy.approvalsMember, whenLabel: formatDate(post.createdAt, timeZone, true, locale, copy) }))}
          caption={copy.approvalsList(listing.page, listing.pages)} locale={locale} timeZone={timeZone} canReview={canReview} reviewAction={reviewWithNoteAction} />
        <PublishingPagination path="/publishing/approvals" page={listing.page} pages={listing.pages} locale={locale} copy={copy} />
      </>}
  </PublishingActionCopyProvider></PublishingCopyProvider>;
}
