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
import { readPublishingPostPage } from "@/modules/publishing/server/read";
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
import styles from "./queue.module.css";

export default async function QueuePage({ searchParams }: { searchParams: Promise<{ page?: string; channel?: string }> }) {
  const viewer = await requireViewer({ feature: "publishing/queue", channelScoped: true });
  const timeZone = viewer.membership.workspace.timezone;
  const locale = await pageLocale();
  const { catalog, copy: localizedCopy } = await loadPublishingCopy();
  const actionCatalog = await loadPublishingActionCopy();
  const copy = localizedCopy[locale];
  const params = await searchParams;
  const { page: pageParam } = params;
  const requestedPage = pageParam && /^[1-9]\d*$/.test(pageParam) && Number.isSafeInteger(Number(pageParam)) ? Number(pageParam) : 1;
  const content = await loadContent();
  const composerCatalog = await loadComposerCopy();
  const scope = await pageChannelScope(viewer, params).catch(() => null);
  const [listing, slotsPerChannel] = await Promise.all([
    readPublishingPostPage({ userId: viewer.user.id, workspaceId: viewer.workspaceId }, { page: requestedPage, status: "scheduled", order: "scheduled_asc", channelId: scope?.ids.length ? scope.ids.join(",") : undefined }, "publishing/queue"),
    runtimeConfig('publishing.queueTimelineSlotsPerChannel'),
  ]);
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
          {mayCancel ? <><CancelScheduleForm postId={post.id} action={cancelScheduledPostAction} locale={locale} /><p className={workflow.help}>{copy.queueCancelHelp}</p></>
            : <p className={workflow.help}>{viewer.permissions.features["publishing/posts"].write ? copy.queueCancelOnly : copy.queueViewOnly}</p>}
          {mayMove && wall ? <RescheduleQueuedPost postId={post.id} date={wall.date} time={wall.time} timeZone={timeZone} text={post.message} /> : null}
          {due ? <p className={workflow.help} role="status">{copy.queueDue}</p> : null}
        </div>;
        return <li key={post.id} className={workflow.item}><PostPreview post={post} authorName={authorName(post.authorId)} timeZone={timeZone} locale={locale} actions={actions} /></li>;
      })}</ul>
    </section>)}
  </>;

  const canAdd = viewer.permissions.features["publishing/posts"].write;
  return <ContentProvider {...content}><PublishingCopyProvider catalog={catalog} locale={locale}><PublishingActionCopyProvider catalog={actionCatalog} locale={locale}><ComposerCopyProvider catalog={composerCatalog} locale={locale}>
    <PageHeader module="publishing" title={copy.queueTitle} count={listing.total.toLocaleString(locale)}
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
      </section>
      <QueueSidePanel actor={{ userId: viewer.user.id, workspaceId: viewer.workspaceId }} timeZone={timeZone} copy={content.copy} />
    </div>
  </ComposerCopyProvider></PublishingActionCopyProvider></PublishingCopyProvider></ContentProvider>;
}
