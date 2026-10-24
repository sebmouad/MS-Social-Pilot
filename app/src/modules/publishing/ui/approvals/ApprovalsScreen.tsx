import { approvalNotice } from '../posts/notices';
import { formatPostPreviewTime } from '@/lib/post-preview-time';
import { loadPublishingCopy, loadPublishingNoticeCopy } from '../../server/customer-copy';
import { PublishingCopyProvider } from '../kit/CopyProvider';
import { loadPublishingActionCopy } from '../../server/action-copy';
import { PublishingActionCopyProvider } from '../WorkflowSubmitButtons';
import { loadContent } from '../../server/content-copy';
import { ContentProvider } from '../ContentProvider';
import { ComposerCopyProvider } from '../compose/CopyProvider';
import { loadComposerCopy } from '../../server/composer-copy';
import { IconChecklist } from '@tabler/icons-react';
import { InfoTip, PageHeader } from '@/components';
import { requireViewer } from "@/server/context";
import { readDraftApprovalSplit, readPublishingPostPage } from "@/modules/publishing/server/read";
import { readPostApprovalStates } from "@/modules/publishing/server/lifecycle";
import { formatDate } from "@/modules/publishing/ui/publishing-ui";
import { EmptyPanel } from "../kit/kit";
import { pageLocale } from "../kit/locale";
import { pageChannelScope } from '@/modules/shell/server/scope';
import publishing from "@/modules/publishing/ui/publishing.module.css";
import { canAccessFeature } from "@/server/permissions";
import { ensurePublishingCollaboration } from '@/modules/publishing/server/collaboration';
import { collaborationCapabilities } from '@/modules/publishing/collaboration/ports';
import { readPostNotes } from '@/modules/publishing/collaboration/server/notes';
import { fillContent } from '../content-copy';
import { reviewWithNoteAction } from "./actions";
import { ApprovalPipeline, type PipelineRow, type PipelineStage } from "./ApprovalPipeline";

const MANAGERS = new Set(["owner", "admin", "editor"]);

export default async function ApprovalsPage({ searchParams }: { searchParams: Promise<{ notice?: string; channel?: string }> }) {
  ensurePublishingCollaboration();
  const viewer = await requireViewer({ feature: "publishing/approvals", channelScoped: true });
  const params = await searchParams;
  const { notice } = params;
  const locale = await pageLocale();
  const { catalog, copy: localizedCopy } = await loadPublishingCopy();
  const noticeCatalog = await loadPublishingNoticeCopy();
  const actionCatalog = await loadPublishingActionCopy();
  const content = await loadContent();
  const composerCatalog = await loadComposerCopy();
  const copy = localizedCopy[locale];
  const scope = await pageChannelScope(viewer, params).catch(() => null);
  const channelArg = scope?.ids.length ? scope.ids.join(",") : undefined;
  const actor = { userId: viewer.user.id, workspaceId: viewer.workspaceId };
  const [drafts, review, scheduled] = await Promise.all([
    readPublishingPostPage(actor, { status: "draft", order: "created_asc", channelId: channelArg }, "publishing/approvals"),
    readPublishingPostPage(actor, { status: "pending_approval", order: "created_asc", channelId: channelArg }, "publishing/approvals"),
    readPublishingPostPage(actor, { status: "scheduled", order: "scheduled_asc", channelId: channelArg }, "publishing/approvals"),
  ]);
  // Approved drafts still carry status draft; the approval workflow state splits them out. Totals are
  // exact over the whole authorized scope; rows show the loaded page, larger backlogs continue in Posts.
  const approvals = await readPostApprovalStates(viewer.workspaceId, drafts.posts.map(post => post.id)).catch(() => new Map());
  const split = await readDraftApprovalSplit(actor, channelArg).catch(() => null);
  const isApproved = (id: string) => approvals.get(id)?.status === "approved";
  const draftPosts = drafts.posts.filter(post => !isApproved(post.id));
  const approvedPosts = drafts.posts.filter(post => isApproved(post.id));
  const canReview = viewer.permissions.features["publishing/approvals"].write;
  const canWriteNotes = canAccessFeature(viewer.permissions, "publishing/posts", "write");
  const canManage = (authorId: string) => MANAGERS.has(viewer.membership.role) || authorId === viewer.user.id;
  const timeZone = viewer.membership.workspace.timezone;
  const feedback = approvalNotice(notice, locale, noticeCatalog);
  // Note times are formatted here so the browser never applies its own time-zone data.
  const stampFormat = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone });
  const zoned = (value: Date) => `${stampFormat.format(value)} ${timeZone}`;
  const perStage = content.policy.pipelinePerStage;
  const caps = collaborationCapabilities();

  type Listed = (typeof drafts.posts)[number];
  const toRow = async (post: Listed, stage: PipelineStage["id"]): Promise<PipelineRow> => {
    const notes = await readPostNotes(actor, { postId: post.id, page: 1 }).catch(() => null);
    const approval = approvals.get(post.id);
    return {
      ...post, media: post.media as Array<{ kind: string; url: string; altText?: string }>,
      authorName: post.authorId === viewer.user.id ? viewer.user.name : copy.approvalsMember,
      whenLabel: formatDate(post.createdAt, timeZone, true, locale, copy),
      displayTime: formatPostPreviewTime(post.publishedAt ?? post.scheduledAt ?? post.createdAt, timeZone),
      canSubmit: stage === "draft" && canWriteNotes && canManage(post.authorId) && post.targets.length > 0,
      ...(stage === "approved" && approval?.reviewedByName ? { stageNote: fillContent(content.copy.approvalsApprovedBy, { name: approval.reviewedByName }) } : {}),
      notes: notes?.notes.map(note => ({ id: note.id, body: note.body, authorId: note.authorId, authorName: note.authorName, createdAt: note.createdAt.toISOString(), createdLabel: zoned(note.createdAt) })) ?? [],
      mentionable: notes && caps.mentionNotifications ? notes.mentionable : [],
      noteMax: notes?.maxCharacters ?? 0,
      notesUnavailable: notes === null,
    };
  };
  const [draftRows, reviewRows, approvedRows, scheduledRows] = await Promise.all([
    Promise.all(draftPosts.slice(0, perStage).map(post => toRow(post, "draft"))),
    Promise.all(review.posts.slice(0, perStage).map(post => toRow(post, "review"))),
    Promise.all(approvedPosts.slice(0, perStage).map(post => toRow(post, "approved"))),
    Promise.all(scheduled.posts.slice(0, perStage).map(post => toRow(post, "scheduled"))),
  ]);
  const channelQuery = params.channel ? `&channel=${encodeURIComponent(params.channel)}` : "";
  const stages: PipelineStage[] = [
    { id: "draft", title: content.copy.approvalsStageDraft, empty: content.copy.approvalsDraftEmpty, total: split?.drafts ?? (drafts.total - approvedPosts.length), rows: draftRows, viewAllHref: `/content?status=draft${channelQuery}` },
    { id: "review", title: content.copy.approvalsStageReview, empty: content.copy.approvalsReviewEmpty, total: review.total, rows: reviewRows, viewAllHref: `/content?status=pending_approval${channelQuery}` },
    { id: "approved", title: content.copy.approvalsStageApproved, empty: content.copy.approvalsApprovedEmpty, total: split?.approved ?? approvedPosts.length, rows: approvedRows, viewAllHref: `/content?status=draft${channelQuery}` },
    { id: "scheduled", title: content.copy.approvalsStageScheduled, empty: content.copy.approvalsScheduledEmpty, total: scheduled.total, rows: scheduledRows, viewAllHref: `/content?status=scheduled${channelQuery}` },
  ];
  const pipelineEmpty = drafts.total + review.total + scheduled.total === 0;

  return <ContentProvider {...content}><PublishingCopyProvider catalog={catalog} locale={locale}><PublishingActionCopyProvider catalog={actionCatalog} locale={locale}><ComposerCopyProvider catalog={composerCatalog} locale={locale}>
    <PageHeader module="publishing" title={copy.approvalsTitle} count={review.total.toLocaleString(locale)} info={<InfoTip name={copy.approvalsTitle}>{content.copy.approvalsInfo}</InfoTip>} />
    {feedback ? <p className={feedback.error ? publishing.errorNotice : publishing.successNotice} role={feedback.error ? "alert" : "status"}>{feedback.text}</p> : null}
    {pipelineEmpty
      ? <EmptyPanel icon={<IconChecklist size={26} aria-hidden="true" />} title={copy.approvalsEmptyTitle} action={<a className="ui-button ui-button--secondary" href="/content?status=draft">{copy.approvalsEmptyAction}</a>}>{copy.approvalsEmptyBody}</EmptyPanel>
      : <ApprovalPipeline stages={stages} locale={locale} timeZone={timeZone} viewerId={viewer.user.id} canReview={canReview} canWriteNotes={canWriteNotes} canModerateNotes={MANAGERS.has(viewer.membership.role)} reviewAction={reviewWithNoteAction} />}
  </ComposerCopyProvider></PublishingActionCopyProvider></PublishingCopyProvider></ContentProvider>;
}
