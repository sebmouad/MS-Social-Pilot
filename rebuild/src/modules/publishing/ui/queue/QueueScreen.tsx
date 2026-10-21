import { loadPublishingCopy } from '../../server/customer-copy';
import { PublishingCopyProvider } from '../kit/CopyProvider';
import { loadPublishingActionCopy } from '../../server/action-copy';
import { PublishingActionCopyProvider } from '../WorkflowSubmitButtons';
import { IconCalendarPlus, IconClockHour4 } from '@tabler/icons-react';
import { SidebarDock } from '@/components/SidebarDock';
import { Tabs } from '@/components';
import { PostPreview } from "@/components/PostPreview";
import { requireViewer } from "@/server/context";
import { runtimeConfig } from '@/server/config/store';
import { readPublishingPostPage } from "@/modules/publishing/server/read";
import { addDaysToKey, instantToWall, workspaceDateKey } from "@/lib/calendar-dates";
import { PageHeading, PublishingPagination } from "@/modules/publishing/ui/publishing-ui";
import { EmptyPanel } from "../kit/kit";
import { pageLocale } from "../kit/locale";
import workflow from "@/modules/publishing/ui/workflow.module.css";
import { CancelScheduleButton } from "@/modules/publishing/ui/WorkflowSubmitButtons";
import { canCancelQueuedPost } from "@/modules/publishing/ui/workflow-access";
import { cancelScheduledPostAction } from "@/modules/publishing/ui/posts/actions";

import { RescheduleQueuedPost } from "./RescheduleQueuedPost";
import { QueueTimeline } from "./QueueTimeline";
import styles from "./queue.module.css";

export default async function QueuePage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const viewer = await requireViewer({ feature: "publishing/queue", channelScoped: true });
  const timeZone = viewer.membership.workspace.timezone;
  const locale = await pageLocale();
  const { catalog, copy: localizedCopy } = await loadPublishingCopy();
  const actionCatalog = await loadPublishingActionCopy();
  const copy = localizedCopy[locale];
  const { page: pageParam } = await searchParams;
  const requestedPage = pageParam && /^[1-9]\d*$/.test(pageParam) && Number.isSafeInteger(Number(pageParam)) ? Number(pageParam) : 1;
  const [listing, slotsPerChannel] = await Promise.all([
    readPublishingPostPage({ userId: viewer.user.id, workspaceId: viewer.workspaceId }, { page: requestedPage, status: "scheduled", order: "scheduled_asc" }, "publishing/queue"),
    runtimeConfig('publishing.queueTimelineSlotsPerChannel'),
  ]);
  const now = new Date();
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
        const mayMove = mayCancel && post.scheduledAt && post.targets.every(target => target.status === "pending" && !target.remotePostId);
        const wall = post.scheduledAt ? instantToWall(post.scheduledAt, timeZone) : null;
        const actions = <div className={workflow.actions}>
          {mayCancel ? <><form noValidate action={cancelScheduledPostAction}><input type="hidden" name="postId" value={post.id} /><CancelScheduleButton locale={locale} /></form><p className={workflow.help}>{copy.queueCancelHelp}</p></>
            : <p className={workflow.help}>{viewer.permissions.features["publishing/posts"].write ? copy.queueCancelOnly : copy.queueViewOnly}</p>}
          {mayMove && wall ? <RescheduleQueuedPost postId={post.id} date={wall.date} time={wall.time} timeZone={timeZone} text={post.message} /> : null}
          {due ? <p className={workflow.help} role="status">{copy.queueDue}</p> : null}
        </div>;
        return <li key={post.id} className={workflow.item}><PostPreview post={post} authorName={authorName(post.authorId)} timeZone={timeZone} locale={locale} actions={actions} /></li>;
      })}</ul>
    </section>)}
  </>;

  return <PublishingCopyProvider catalog={catalog} locale={locale}><PublishingActionCopyProvider catalog={actionCatalog} locale={locale}>
    <SidebarDock><a className="text-link" href="/publishing/collaboration?view=queue">{copy.queueQueueTimes}</a></SidebarDock>
    <PageHeading href="/publishing/queue" title={copy.queueTitle} description={copy.queueDescription(timeZone.replaceAll("_", " "))} summary={copy.queueSummary(listing.total, listing.page, listing.pages)}
      actions={<a className="ui-button ui-button--secondary" href="/publishing/collaboration?view=queue"><IconClockHour4 size={16} aria-hidden="true" /> {copy.queueQueueTimes}</a>} />
    {listing.total === 0
      ? <EmptyPanel icon={<IconCalendarPlus size={26} aria-hidden="true" />} title={copy.queueEmptyTitle} action={<span className={styles.emptyActions}><a className="ui-button ui-button--primary" href="/publishing/compose">{copy.queueEmptyAction}</a><a className="ui-button ui-button--secondary" href="/publishing/calendar">{copy.queueCalendar}</a></span>}>{copy.queueEmptyBody}</EmptyPanel>
      : <>
        <Tabs label={copy.queueTitle} items={[
          { id: 'day', label: copy.byDay, count: listing.posts.length, content: byDay },
          { id: 'channel', label: copy.queueByChannel, content: <QueueTimeline posts={listing.posts} timeZone={timeZone} locale={locale} maxPerChannel={Number(slotsPerChannel)} /> },
        ]} />
        <PublishingPagination path="/publishing/queue" page={listing.page} pages={listing.pages} locale={locale} copy={copy} />
      </>}
  </PublishingActionCopyProvider></PublishingCopyProvider>;
}
