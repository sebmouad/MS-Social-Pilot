import { approvalNotice } from '../posts/notices';
import { loadPublishingCopy, loadPublishingNoticeCopy } from '../../server/customer-copy';
import { PublishingCopyProvider } from '../kit/CopyProvider';
import { loadPublishingActionCopy } from '../../server/action-copy';
import { PublishingActionCopyProvider } from '../WorkflowSubmitButtons';
import { loadContent } from '../../server/content-copy';
import { ContentProvider } from '../ContentProvider';
import { IconChecklist } from '@tabler/icons-react';
import { InfoTip, PageHeader } from '@/components';
import { requireViewer } from "@/server/context";
import { readPublishingPostPage } from "@/modules/publishing/server/read";
import { PublishingPagination, formatDate } from "@/modules/publishing/ui/publishing-ui";
import { EmptyPanel } from "../kit/kit";
import { pageLocale } from "../kit/locale";
import { pageChannelScope } from '@/modules/shell/server/scope';
import publishing from "@/modules/publishing/ui/publishing.module.css";
import { reviewWithNoteAction } from "./actions";
import { ApprovalsList } from "./ApprovalsList";

export default async function ApprovalsPage({ searchParams }: { searchParams: Promise<{ notice?: string; page?: string; channel?: string }> }) {
  const viewer = await requireViewer({ feature: "publishing/approvals", channelScoped: true });
  const params = await searchParams;
  const { notice, page: pageParam } = params;
  const locale = await pageLocale();
  const { catalog, copy: localizedCopy } = await loadPublishingCopy();
  const noticeCatalog = await loadPublishingNoticeCopy();
  const actionCatalog = await loadPublishingActionCopy();
  const content = await loadContent();
  const copy = localizedCopy[locale];
  const requestedPage = pageParam && /^[1-9]\d*$/.test(pageParam) && Number.isSafeInteger(Number(pageParam)) ? Number(pageParam) : 1;
  const scope = await pageChannelScope(viewer, params).catch(() => null);
  const listing = await readPublishingPostPage({ userId: viewer.user.id, workspaceId: viewer.workspaceId }, { page: requestedPage, status: "pending_approval", order: "created_asc", channelId: scope?.ids.length ? scope.ids.join(",") : undefined }, "publishing/approvals");
  const canReview = viewer.permissions.features["publishing/approvals"].write;
  const timeZone = viewer.membership.workspace.timezone;
  const feedback = approvalNotice(notice, locale, noticeCatalog);

  return <ContentProvider {...content}><PublishingCopyProvider catalog={catalog} locale={locale}><PublishingActionCopyProvider catalog={actionCatalog} locale={locale}>
    <PageHeader module="publishing" title={copy.approvalsTitle} count={listing.total.toLocaleString(locale)} info={<InfoTip name={copy.approvalsTitle}>{content.copy.approvalsInfo}</InfoTip>} />
    {feedback ? <p className={feedback.error ? publishing.errorNotice : publishing.successNotice} role={feedback.error ? "alert" : "status"}>{feedback.text}</p> : null}
    {listing.total === 0
      ? <EmptyPanel icon={<IconChecklist size={26} aria-hidden="true" />} title={copy.approvalsEmptyTitle} action={<a className="ui-button ui-button--secondary" href="/content?status=draft">{copy.approvalsEmptyAction}</a>}>{copy.approvalsEmptyBody}</EmptyPanel>
      : <>
        <ApprovalsList rows={listing.posts.map(post => ({ ...post, media: post.media as Array<{ kind: string; url: string; altText?: string }>, authorName: post.authorId === viewer.user.id ? viewer.user.name : copy.approvalsMember, whenLabel: formatDate(post.createdAt, timeZone, true, locale, copy) }))}
          locale={locale} timeZone={timeZone} canReview={canReview} reviewAction={reviewWithNoteAction} />
        <PublishingPagination path="/content/approvals" page={listing.page} pages={listing.pages} locale={locale} copy={copy} />
      </>}
  </PublishingActionCopyProvider></PublishingCopyProvider></ContentProvider>;
}
