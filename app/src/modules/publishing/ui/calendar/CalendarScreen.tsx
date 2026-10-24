import { configOrDefault } from '@/server/config/config-or-default';
import { reschedulePolicySchema } from '@/lib/config/reschedule-policy';
import { InfoTip, PageHeader } from '@/components';
import { pageLocale } from '../kit/locale';
import { loadContent } from '../../server/content-copy';
import { ContentProvider } from '../ContentProvider';
import { CalendarToolbar } from './CalendarToolbar';
import { CalendarMore } from './CalendarMore';
import { calendarExtrasLinks } from '@/modules/calendar-extras/server/links';
import { pageChannelScope } from '@/modules/shell/server/scope';
import { postGroup } from '@/lib/post-groups';
import { readQueueSlots } from '../../collaboration/server/queue-slots';
import { freeQueueSlots } from './free-slots';
import { canUseFeature } from '@/server/entitlements';
import { originFilterOptions } from '../origins/load';
import { originCopy } from '../origins/copy';
import { statusLabel } from '@/components';
import { loadPublishingCopy } from '../../server/customer-copy';
import { PublishingCopyProvider } from '../kit/CopyProvider';
import { requireViewer } from "@/server/context";
import { readPublishingCalendar } from "@/modules/publishing/server/read";
import { canAccessFeature } from "@/server/permissions";
import { adjacentCalendarMonth, addDaysToKey, calendarMonth, instantToWall, isDateKey, postCalendarDate, wallTimeToInstant, weekOffsetOfKey, weekStartKey, workspaceDateKey } from "@/lib/calendar-dates";
import { loadWorkspaceOperations } from "@/modules/settings/server/workspace-operations";
import { channelBadgeInfo } from "@/lib/channel-badge";
import { formatPostPreviewTime } from "@/lib/post-preview-time";
import { moveCandidates } from "@/lib/reschedule";
import { loadBoardMilestones } from "@/modules/calendar-extras/server/board";
import { CalendarBoard } from "./CalendarBoard";
import { loadPostOrigins, parseOriginFilter } from "../origins/load";
import { runtimeConfig } from '@/server/config/store';
import type { BoardDay, BoardPost, CalendarGuardrails } from "./types";
import { getAutopilotPolicy } from "@/modules/studio/agents/server/autopilot";
import styles from "./calendar.module.css";
import { postContentSummary } from '@/modules/publishing/content-summary';
import { isWaitingToReschedule } from '../../schedule-state';

type Params = { view?: string; date?: string; month?: string; channel?: string; status?: string; origin?: string };
const STATUSES = ["draft", "pending_approval", "rejected", "scheduled", "publishing", "published", "partially_failed", "failed", "cancelled"] as const;
const MANAGERS = new Set(["owner", "admin", "editor"]);
const DAY = 24 * 60 * 60 * 1000;

const utcNoon = (key: string) => new Date(`${key}T12:00:00Z`);


export default async function CalendarPage({ searchParams }: { searchParams: Promise<Params> }) {
  const viewer = await requireViewer({ feature: "publishing/calendar", channelScoped: true });
  const locale = await pageLocale();
  const { catalog, copy: localizedCopy } = await loadPublishingCopy();
  const copy = localizedCopy[locale];
  const formatUtc = (key: string, options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(locale === "fr" ? "fr-FR" : "en-US", { ...options, timeZone: "UTC" }).format(utcNoon(key));
  const reschedulePolicy = (await configOrDefault('shared.reschedulePolicy', reschedulePolicySchema));
  const movePolicy = { ...reschedulePolicy, locale: locale === "fr" ? "fr-FR" as const : "en-US" as const };
  const defaultScheduleTime = await runtimeConfig('publishing.defaultScheduleTime') as string;
  const timeZone = viewer.membership.workspace.timezone;
  const params = await searchParams;
  const now = new Date();
  const today = workspaceDateKey(now, timeZone);
  const view = params.view === "week" ? "week" : params.view === "list" ? "list" : "month";
  const month = params.month && /^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(params.month) ? params.month : undefined;
  const anchor = isDateKey(params.date) ? params.date : month ? (month === today.slice(0, 7) ? today : `${month}-01`) : today;

  // The sidebar's channel scope: one channel is read by the service; several are narrowed to "any of them" after the authorized read.
  const scope = await pageChannelScope(viewer, params as Record<string, string | undefined>).catch(() => null);
  const scopeIds = scope?.ids ?? [];
  const channelId = scopeIds.length === 1 ? scopeIds[0] : undefined;
  const content = await loadContent();
  const originKind = parseOriginFilter(params.origin);
  const status = (STATUSES as readonly string[]).includes(params.status ?? "") ? params.status as (typeof STATUSES)[number] : undefined;

  // The days on screen: a whole month grid (weeks start on the workspace's first weekday) or one week.
  const selected = calendarMonth(anchor.slice(0, 7), now, timeZone);
  const firstOfMonth = `${selected.key}-01`;
  const daysInMonth = new Date(Date.UTC(selected.year, selected.month, 0)).getUTCDate();
  const weekStartsOn = await loadWorkspaceOperations(viewer.workspaceId).then(value => value.weekStartsOn, () => 0);
  const weekLike = view === "week" || view === "list";
  const gridStart = weekLike ? weekStartKey(anchor, weekStartsOn) : weekStartKey(firstOfMonth, weekStartsOn);
  const count = weekLike ? 7 : Math.ceil((weekOffsetOfKey(firstOfMonth, weekStartsOn) + daysInMonth) / 7) * 7;
  const keys = Array.from({ length: count }, (_, index) => addDaysToKey(gridStart, index));

  const from = new Date(utcNoon(keys[0]!).getTime() - 2 * DAY);
  const to = new Date(utcNoon(keys[keys.length - 1]!).getTime() + 2 * DAY);
  const { posts: visiblePosts, channels, channelUnavailable } = await readPublishingCalendar({ userId: viewer.user.id, workspaceId: viewer.workspaceId }, { from, to, channelId, status });

  const origins = await loadPostOrigins(viewer.workspaceId, visiblePosts.map(post => post.id), locale);
  // The origin and multi-channel filters narrow the already authorized read; they never widen it.
  const inScope = scopeIds.length > 1 ? visiblePosts.filter(post => post.targets.some(({ target }) => scopeIds.includes(target.id))) : visiblePosts;
  const posts = originKind ? inScope.filter(post => origins.get(post.id)?.kind === originKind) : inScope;
  const canEditCalendar = canAccessFeature(viewer.permissions, "publishing/calendar", "write");
  const canCreate = canAccessFeature(viewer.permissions, "publishing/posts", "write");
  const byDay = new Map<string, BoardPost[]>();
  for (const post of posts) {
    const when = postCalendarDate(post);
    if (!when) continue;
    const wallTime = instantToWall(when, timeZone);
    const key = workspaceDateKey(when, timeZone);
    const channelsOfPost = [...new Map(post.targets.map(({ target }) => [target.id, { id: target.id, name: target.name, ...channelBadgeInfo(target.socialAccount?.provider) }])).values()];
    const movable = canEditCalendar && post.targets.length > 0 && isWaitingToReschedule(post)
      && (MANAGERS.has(viewer.membership.role) || post.authorId === viewer.user.id);
    byDay.set(key, [...(byDay.get(key) ?? []), {
      id: post.id, text: postContentSummary(post.message, post.media, post.link, copy).slice(0, 240), status: post.status, whenIso: when.toISOString(), channels: channelsOfPost, movable,
      authorName: post.authorId === viewer.user.id ? viewer.user.name : copy.approvalsMember,
      origin: origins.get(post.id),
      clockLabel: formatPostPreviewTime(when, timeZone),
      wallTime,
      moveOptions: movable ? moveCandidates(when.toISOString(), timeZone, now.getTime(), movePolicy) : undefined,
      preview: {
        id: post.id, authorId: post.authorId, message: post.message, firstComment: post.firstComment, link: post.link, media: post.media,
        status: post.status, scheduledAt: post.scheduledAt, publishedAt: post.publishedAt, createdAt: post.createdAt,
        displayTime: formatPostPreviewTime(post.publishedAt ?? post.scheduledAt ?? post.createdAt, timeZone),
        targets: post.targets.map(({ id, status, remotePostId, remoteUrl, firstCommentId, firstCommentAt, firstCommentError, target }) => ({ id, status, remotePostId, remoteUrl, firstCommentId, firstCommentAt, firstCommentError, target })),
      },
    }]);
  }
  const milestones = await loadBoardMilestones({ userId: viewer.user.id, workspaceId: viewer.workspaceId, locale }, keys, channelId);
  // Free queue times: the weekly queue times of the channels in view that no post already uses, from today on. A lookup failure only hides the pills.
  let freeSlots = new Map<string, string[]>();
  try {
    if (canCreate && content.policy.freeSlotsPerDay > 0 && canUseFeature(viewer.entitlements, 'publishing/queue') && canAccessFeature(viewer.permissions, 'publishing/queue', 'read')) {
      const weekly = (await readQueueSlots({ userId: viewer.user.id, workspaceId: viewer.workspaceId })).slots.filter(slot => slot.targetId === null || scopeIds.length === 0 || scopeIds.includes(slot.targetId));
      freeSlots = freeQueueSlots({ keys, today, nowTime: instantToWall(now, timeZone).time, weekly, taken: key => new Set((byDay.get(key) ?? []).map(post => post.wallTime?.time)), limit: content.policy.freeSlotsPerDay });
    }
  } catch { /* the pills are a convenience: without queue times the calendar simply shows none */ }
  const days: BoardDay[] = keys.map(key => ({
    key,
    milestones: milestones[key],
    freeSlots: freeSlots.get(key),
    label: formatUtc(key, { weekday: "short", day: "numeric" }),
    longLabel: formatUtc(key, { weekday: "long", month: "long", day: "numeric" }),
    inMonth: key.startsWith(selected.key),
    isToday: key === today,
    isPast: key < today,
    slotEndedByHour: view === "week" ? Object.fromEntries(Array.from({ length: 24 }, (_, hour) => {
      const time = `${String(hour).padStart(2, "0")}:00`;
      const slot = wallTimeToInstant(key, time, timeZone);
      return [time, slot.ok ? slot.instant.getTime() + 60 * 60 * 1000 <= now.getTime() : key < today];
    })) : undefined,
    posts: (byDay.get(key) ?? []).sort((a, b) => a.whenIso.localeCompare(b.whenIso)),
  }));

  const filterQuery = `${params.channel ? `&channel=${encodeURIComponent(params.channel)}` : ""}${status ? `&status=${status}` : ""}${originKind ? `&origin=${encodeURIComponent(originKind)}` : ""}`;
  const href = (nextView: string, date: string) => `/content/calendar?view=${nextView}&date=${date}${filterQuery}`;
  const originOptions = await originFilterOptions(viewer.workspaceId, locale).catch(() => []);
  const extraCalendars = await calendarExtrasLinks(locale, ['dates', 'seasons', 'trends', 'feeds']).catch(() => []);
  const without = (omit: "status" | "origin") => `/content/calendar?view=${view}&date=${anchor}${params.channel ? `&channel=${encodeURIComponent(params.channel)}` : ""}${status && omit !== "status" ? `&status=${status}` : ""}${originKind && omit !== "origin" ? `&origin=${encodeURIComponent(originKind)}` : ""}`;
  const chips = [
    ...(status ? [{ key: "status", label: copy.status, value: statusLabel(status), removeHref: without("status") }] : []),
    ...(originKind ? [{ key: "origin", label: originCopy[locale].createdBy, value: originOptions.find(option => option.kind === originKind)?.label ?? originKind, removeHref: without("origin") }] : []),
  ];
  const previous = weekLike ? addDaysToKey(gridStart, -7) : `${adjacentCalendarMonth(selected.year, selected.month, -1)}-01`;
  const next = weekLike ? addDaysToKey(gridStart, 7) : `${adjacentCalendarMonth(selected.year, selected.month, 1)}-01`;
  const rangeLabel = view === "month" ? formatUtc(firstOfMonth, { month: "long", year: "numeric" }) : (() => {
    const last = keys[6]!;
    const sameMonth = gridStart.slice(0, 7) === last.slice(0, 7);
    return sameMonth ? `${formatUtc(gridStart, { month: "short", day: "numeric" })} – ${Number(last.slice(8))}, ${last.slice(0, 4)}` : `${formatUtc(gridStart, { month: "short", day: "numeric" })} – ${formatUtc(last, { month: "short", day: "numeric", year: "numeric" })}`;
  })();
  const unit = weekLike ? "week" : "month";
  // Advisory guardrails only: the resolved autopilot quiet window and daily cap plus the scheduled
  // posts already on each visible day. A lookup failure hides the warnings rather than the calendar.
  let guardrails: CalendarGuardrails | undefined;
  try {
    const policy = await getAutopilotPolicy(viewer.workspaceId);
    const sendsByDay: Record<string, number> = {};
    for (const [key, dayPosts] of byDay) {
      const sends = dayPosts.filter(post => post.status === "scheduled" || post.status === "publishing").length;
      if (sends) sendsByDay[key] = sends;
    }
    guardrails = { quietStartHour: policy.quietStartHour, quietEndHour: policy.quietEndHour, maxSendsPerDay: policy.maxSendsPerDay, sendsByDay };
  } catch { guardrails = undefined; }

  return <ContentProvider {...content}><PublishingCopyProvider catalog={catalog} locale={locale}>
    <PageHeader module="publishing" title={copy.calendarTitle} info={<InfoTip name={copy.calendarTitle}>{content.copy.calendarInfo}</InfoTip>}
      actions={<><CalendarMore links={extraCalendars} />{canCreate ? <a className="ui-button ui-button--primary" href="/create">{copy.newPost}</a> : undefined}</>} />
    {channelUnavailable ? <p role="status">{copy.unavailableChannel}</p> : null}
    <CalendarToolbar navigation={{ previous: href(view, previous), today: href(view, today), next: href(view, next), unit }} rangeLabel={rangeLabel} view={view} counts={{ planned: posts.filter(post => postGroup(post.status) === 'planned').length, published: posts.filter(post => post.status === 'published').length }}
      viewHrefs={{ month: href("month", anchor), week: href("week", anchor), list: href("list", anchor) }} statuses={STATUSES.map(value => ({ value, label: value === "pending_approval" || value === "partially_failed" ? copy[`calendarStatus_${value}`] : copy[`status_${value}`] }))}
      origins={originOptions} chips={chips} resetHref={`/content/calendar?view=${view}&date=${anchor}${params.channel ? `&channel=${encodeURIComponent(params.channel)}` : ""}`} />
    <CalendarBoard view={view} days={days} timeZone={timeZone} nowIso={now.toISOString()} canCreate={canCreate} filterQuery={filterQuery} defaultScheduleTime={defaultScheduleTime} guardrails={guardrails} />
  </PublishingCopyProvider></ContentProvider>;
}
