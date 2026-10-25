import { loadPublishingCopy } from '../../server/customer-copy';
import { PublishingCopyProvider } from '../kit/CopyProvider';
import { loadPublishingActionCopy } from '../../server/action-copy';
import { PublishingActionCopyProvider } from '../WorkflowSubmitButtons';
import { IconCalendarPlus } from '@tabler/icons-react';
import { InfoTip, PageHeader, Tabs } from '@/components';
import { loadContent } from '../../server/content-copy';
import { ContentProvider } from '../ContentProvider';
import { loadComposerCopy } from '../../server/composer-copy';
import { ComposerCopyProvider } from '../compose/CopyProvider';
import { QueueSidePanel } from './QueueSidePanel';
import { pageChannelScope } from '@/modules/shell/server/scope';
import { PostPreview } from "@/components/PostPreview";
import { requireViewer } from "@/server/context";
import { runtimeConfig } from '@/server/config/store';
import { readPublishingPostPage, readPublishingStatusCounts } from "@/modules/publishing/server/read";
import { QueueSent } from "./QueueSent";
import { addDaysToKey, instantToWall, workspaceDateKey } from "@/lib/calendar-dates";
import { PublishingPagination } from "@/modules/publishing/ui/publishing-ui";
import { EmptyPanel } from "../kit/kit";
import { pageLocale } from "../kit/locale";
import workflow from "@/modules/publishing/ui/workflow.module.css";
import { CancelScheduleForm } from "./CancelScheduleForm";
import { canCancelQueuedPost } from "@/modules/publishing/ui/workflow-access";
import { isWaitingToReschedule } from '../../schedule-state';
import { cancelScheduledPostAction } from "@/modules/publishing/ui/posts/actions";

import { RescheduleQueuedPost } from "./RescheduleQueuedPost";
import { QueueTimeline } from "./QueueTimeline";
import { loadPostOrigins } from "../origins/load";
import { OriginBadge } from "../origins/OriginBadge";
import styles from "./queue.module.css";

export default async function QueuePage({ searchParams }: { searchParams: Promise<{ page?: string; channel?: string }> }) {
  const viewer = await requireViewer({ feature: "publishing/queue", channelScoped: true });
  const timeZone = viewer.membership.workspace.timezone;
  const params = await searchParams;
  const { page: pageParam } = params;
  const requestedPage = pageParam && /^[1-9]\d*$/.test(pageParam) && Number.isSafeInteger(Number(pageParam)) ? Number(pageParam) : 1;
  // Independent reads run together; the page waits for the slowest instead of their sum.
  const [locale, { catalog, copy: localizedCopy }, actionCatalog, content, composerCatalog, scope] = await Promise.all([
    pageLocale(), loadPublishingCopy(), loadPublishingActionCopy(), loadContent(), loadComposerCopy(), pageChannelScope(viewer, params).catch(() => null),
  ]);
  const copy = localizedCopy[locale];
  const channelId = scope?.ids.length ? scope.ids.join(",") : undefined;
  // Published/failed context for the header and the Sent block, in the same channel scope. A failed count falls back to the scheduled-only total, which never mixes states.
  const [listing, slotsPerChannel, counts] = await Promise.all([
    readPublishingPostPage({ userId: viewer.user.id, workspaceId: viewer.workspaceId }, { page: requestedPage, status: "scheduled", order: "scheduled_asc", channelId }, "publishing/queue"),
    runtimeConfig('publishing.queueTimelineSlotsPerChannel'),
    readPublishingStatusCounts({ userId: viewer.user.id, workspaceId: viewer.workspaceId }, { ...(channelId === undefined ? {} : { channelId }) }, "publishing/queue").catch(() => null),
  ]);
  const origins = await loadPostOrigins(viewer.workspaceId, listing.posts.map(post => post.id), locale);
  const now = new Date();
  const slotFormat = new Intl.DateTimeFormat(locale, { timeZone, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const today = workspaceDateKey(now, timeZone);
  const tomorrow = addDaysToKey(today, 1);

  const groups = new Map<string, typeof listing.posts>();
  for (const post of listing.posts) {
    const key = post.scheduledAt ? workspaceDateKey(post.scheduledAt, timeZone) : "unscheduled";
    groups.set(key, [...(groups.get(key) ?? []), post]);
  }
  const dayHeading = (key: string) => key === "unscheduled" ? copy.queueUnscheduled : `${key === today ? `${copy.queueToday} · ` : key === tomorrow ? `${copy.queueTomorrow} · ` : ""}${new Intl.DateTimeFormat(locale, { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" }).format(new Date(`${key}T12:00:00Z`))}`;
  const authorName = (authorId: string) => authorId === viewer.user.id ? viewer.user.name : copy.approvalsMember;

  const byDay = <>
    {[...groups.entries()].map(([key, posts]) => <section key={key} className={workflow.group} aria-labelledby={`queue-${key}`}>
      <h2 id={`queue-${key}`} className={workflow.groupHeading}>{dayHeading(key)}</h2>
      <ul className={workflow.items} aria-label={dayHeading(key)}>{posts.map(post => {
        const due = post.scheduledAt !== null && post.scheduledAt <= now;
        const mayCancel = canCancelQueuedPost({ canWritePosts: viewer.permissions.features["publishing/posts"].write, role: viewer.membership.role, userId: viewer.user.id, authorId: post.authorId });
        const mayMove = mayCancel && post.scheduledAt && post.targets.length > 0 && isWaitingToReschedule(post);
        const wall = post.scheduledAt ? instantToWall(post.scheduledAt, timeZone) : null;
        const actions = <div className={workflow.actions}>
          {origins.get(post.id) ? <OriginBadge origin={origins.get(post.id)!} compact /> : null}
          {mayCancel ? <><CancelScheduleForm postId={post.id} action={cancelScheduledPostAction} locale={locale} /><p className={workflow.help}>{copy.queueCancelHelp}</p></>
            : <p className={workflow.help}>{viewer.permissions.features["publishing/posts"].write ? copy.queueCancelOnly : copy.queueViewOnly}</p>}
          {mayMove && wall ? <RescheduleQueuedPost postId={post.id} date={wall.date} time={wall.time} timeZone={timeZone} text={post.message} targetIds={post.targets.map(row => row.target.id)} /> : null}
          {due ? <p className={workflow.help} role="status">{copy.queueDue}</p> : null}
        </div>;
        return <li key={post.id} className={workflow.item}><PostPreview variant="compact" post={post} authorName={authorName(post.authorId)} timeZone={timeZone} locale={locale} actions={actions} /></li>;
      })}</ul>
    </section>)}
  </>;

  const canAdd = viewer.permissions.features["publishing/posts"].write;
  // The queue lists scheduled posts only; the header pairs that planned count with the published count and the Sent block links out to both outcomes.
  const channelSuffix = params.channel ? `&channel=${encodeURIComponent(params.channel)}` : "";
  const sentCopy = { title: copy.queueSentTitle, body: copy.queueSentBody, reviewSent: copy.queueReviewSent, reviewFailed: copy.queueReviewFailed };
  const sentBlock = counts && (counts.published > 0 || counts.failed > 0)
    ? <QueueSent copy={sentCopy} published={counts.published} failed={counts.failed} sentHref={`/content?status=published${channelSuffix}`} failedHref={`/content?status=failed${channelSuffix}`} />
    : null;
  return <ContentProvider {...content}><PublishingCopyProvider catalog={catalog} locale={locale}><PublishingActionCopyProvider catalog={actionCatalog} locale={locale}><ComposerCopyProvider catalog={composerCatalog} locale={locale}>
    <PageHeader module="publishing" title={copy.queueTitle} count={counts ? copy.plannedPublished(listing.total.toLocaleString(locale), counts.published.toLocaleString(locale)) : listing.total.toLocaleString(locale)}
      info={<InfoTip name={copy.queueTitle}>{`${content.copy.queueInfo} ${copy.queueDescription(timeZone.replaceAll("_", " "))}`}</InfoTip>}
      actions={canAdd ? <a className="ui-button ui-button--primary" href="/create">{content.copy.queueAdd}</a> : undefined} />
    <div className={styles.layout}>
      <section className={styles.main} aria-labelledby="queue-next">
        <h2 id="queue-next">{content.copy.queueNext}</h2>
        {listing.total === 0
          ? <EmptyPanel icon={<IconCalendarPlus size={26} aria-hidden="true" />} title={copy.queueEmptyTitle} action={<span className={styles.emptyActions}><a className="ui-button ui-button--primary" href="/create">{copy.queueEmptyAction}</a><a className="ui-button ui-button--secondary" href="/content/calendar">{copy.queueCalendar}</a></span>}>{content.copy.queueNextEmpty}</EmptyPanel>
          : <>
            <Tabs label={copy.queueTitle} items={[
              { id: 'day', label: copy.byDay, count: listing.posts.length, content: byDay },
              { id: 'channel', label: copy.queueByChannel, content: <QueueTimeline posts={listing.posts.map(post => ({ ...post, scheduledLabel: post.scheduledAt ? slotFormat.format(post.scheduledAt) : undefined }))} locale={locale} maxPerChannel={Number(slotsPerChannel)} /> },
            ]} />
            <PublishingPagination path="/content/queue" page={listing.page} pages={listing.pages} locale={locale} copy={copy} />
          </>}
        {sentBlock}
      </section>
      <QueueSidePanel actor={{ userId: viewer.user.id, workspaceId: viewer.workspaceId }} timeZone={timeZone} copy={content.copy} />
    </div>
  </ComposerCopyProvider></PublishingActionCopyProvider></PublishingCopyProvider></ContentProvider>;
}
