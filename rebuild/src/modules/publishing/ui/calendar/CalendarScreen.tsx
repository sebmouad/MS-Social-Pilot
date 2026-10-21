import { reschedulePolicySchema } from '@/lib/config/reschedule-policy';
import { pageLocale } from '../kit/locale';
import { loadPublishingCopy } from '../../server/customer-copy';
import { PublishingCopyProvider } from '../kit/CopyProvider';
import { requireViewer } from "@/server/context";
import { readPublishingCalendar } from "@/modules/publishing/server/read";
import { canAccessFeature } from "@/server/permissions";
import { PageHeading } from "@/modules/publishing/ui/publishing-ui";
import { adjacentCalendarMonth, addDaysToKey, calendarMonth, instantToWall, isDateKey, postCalendarDate, wallTimeToInstant, weekOffsetOfKey, weekStartKey, workspaceDateKey } from "@/lib/calendar-dates";
import { loadWorkspaceOperations } from "@/modules/settings/server/workspace-operations";
import { channelBadgeInfo } from "@/lib/channel-badge";
import { formatPostPreviewTime } from "@/components/PostPreview";
import { moveCandidates } from "@/lib/reschedule";
import { CalendarBoard } from "./CalendarBoard";
import { runtimeConfig } from '@/server/config/store';
import type { BoardDay, BoardPost } from "./types";
import styles from "./calendar.module.css";
import { postContentSummary } from '@/modules/publishing/content-summary';

type Params = { view?: string; date?: string; month?: string; channel?: string; status?: string };
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
  const reschedulePolicy = reschedulePolicySchema.parse(await runtimeConfig('shared.reschedulePolicy'));
  const movePolicy = { ...reschedulePolicy, locale: locale === "fr" ? "fr-FR" as const : "en-US" as const };
  const defaultScheduleTime = await runtimeConfig('publishing.defaultScheduleTime') as string;
  const timeZone = viewer.membership.workspace.timezone;
  const params = await searchParams;
  const now = new Date();
  const today = workspaceDateKey(now, timeZone);
  const view = params.view === "week" ? "week" : "month";
  const month = params.month && /^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(params.month) ? params.month : undefined;
  const anchor = isDateKey(params.date) ? params.date : month ? (month === today.slice(0, 7) ? today : `${month}-01`) : today;

  const channelId = params.channel || undefined;
  const status = (STATUSES as readonly string[]).includes(params.status ?? "") ? params.status as (typeof STATUSES)[number] : undefined;

  // The days on screen: a whole month grid (weeks start on the workspace's first weekday) or one week.
  const selected = calendarMonth(anchor.slice(0, 7), now, timeZone);
  const firstOfMonth = `${selected.key}-01`;
  const daysInMonth = new Date(Date.UTC(selected.year, selected.month, 0)).getUTCDate();
  const weekStartsOn = await loadWorkspaceOperations(viewer.workspaceId).then(value => value.weekStartsOn, () => 0);
  const gridStart = view === "week" ? weekStartKey(anchor, weekStartsOn) : weekStartKey(firstOfMonth, weekStartsOn);
  const count = view === "week" ? 7 : Math.ceil((weekOffsetOfKey(firstOfMonth, weekStartsOn) + daysInMonth) / 7) * 7;
  const keys = Array.from({ length: count }, (_, index) => addDaysToKey(gridStart, index));

  const from = new Date(utcNoon(keys[0]!).getTime() - 2 * DAY);
  const to = new Date(utcNoon(keys[keys.length - 1]!).getTime() + 2 * DAY);
  const { posts, channels, channelUnavailable } = await readPublishingCalendar({ userId: viewer.user.id, workspaceId: viewer.workspaceId }, { from, to, channelId, status });

  const canEditCalendar = canAccessFeature(viewer.permissions, "publishing/calendar", "write");
  const canCreate = canAccessFeature(viewer.permissions, "publishing/posts", "write");
  const byDay = new Map<string, BoardPost[]>();
  for (const post of posts) {
    const when = postCalendarDate(post);
    if (!when) continue;
    const wallTime = instantToWall(when, timeZone);
    const key = workspaceDateKey(when, timeZone);
    const channelsOfPost = [...new Map(post.targets.map(({ target }) => [target.id, { id: target.id, name: target.name, ...channelBadgeInfo(target.socialAccount?.provider) }])).values()];
    const movable = canEditCalendar && post.status === "scheduled" && post.targets.length > 0 && post.targets.every(target => target.status === "pending" && !target.remotePostId)
      && (MANAGERS.has(viewer.membership.role) || post.authorId === viewer.user.id);
    byDay.set(key, [...(byDay.get(key) ?? []), {
      id: post.id, text: postContentSummary(post.message, post.media, post.link, copy).slice(0, 240), status: post.status, whenIso: when.toISOString(), channels: channelsOfPost, movable,
      authorName: post.authorId === viewer.user.id ? viewer.user.name : copy.approvalsMember,
      clockLabel: formatPostPreviewTime(when, timeZone),
      wallTime,
      moveOptions: movable ? moveCandidates(when.toISOString(), timeZone, now.getTime(), movePolicy) : undefined,
      preview: {
        id: post.id, authorId: post.authorId, message: post.message, firstComment: post.firstComment, link: post.link, media: post.media,
        status: post.status, scheduledAt: post.scheduledAt, publishedAt: post.publishedAt, createdAt: post.createdAt,
        displayTime: formatPostPreviewTime(post.publishedAt ?? post.scheduledAt ?? post.createdAt, timeZone),
        targets: post.targets.map(({ status, remotePostId, remoteUrl, target }) => ({ status, remotePostId, remoteUrl, target })),
      },
    }]);
  }
  const days: BoardDay[] = keys.map(key => ({
    key,
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

  const filterQuery = `${channelId ? `&channel=${encodeURIComponent(channelId)}` : ""}${status ? `&status=${status}` : ""}`;
  const href = (nextView: string, date: string) => `/publishing/calendar?view=${nextView}&date=${date}${filterQuery}`;
  const previous = view === "week" ? addDaysToKey(gridStart, -7) : `${adjacentCalendarMonth(selected.year, selected.month, -1)}-01`;
  const next = view === "week" ? addDaysToKey(gridStart, 7) : `${adjacentCalendarMonth(selected.year, selected.month, 1)}-01`;
  const rangeLabel = view === "month" ? formatUtc(firstOfMonth, { month: "long", year: "numeric" }) : (() => {
    const last = keys[6]!;
    const sameMonth = gridStart.slice(0, 7) === last.slice(0, 7);
    return sameMonth ? `${formatUtc(gridStart, { month: "short", day: "numeric" })} – ${Number(last.slice(8))}, ${last.slice(0, 4)}` : `${formatUtc(gridStart, { month: "short", day: "numeric" })} – ${formatUtc(last, { month: "short", day: "numeric", year: "numeric" })}`;
  })();
  const unit = view === "week" ? "week" : "month";

  return <PublishingCopyProvider catalog={catalog} locale={locale}>
    <PageHeading title={copy.calendarTitle} description={copy.calendarDescription} />
    {channelUnavailable ? <p role="status">{copy.unavailableChannel}</p> : null}
    <h2 className={styles.range} aria-live="polite">{rangeLabel}</h2>
    <CalendarBoard view={view} days={days} timeZone={timeZone} nowIso={now.toISOString()} canCreate={canCreate} filterQuery={filterQuery} defaultScheduleTime={defaultScheduleTime}
      navigation={{ previous: href(view, previous), today: href(view, today), next: href(view, next), unit }} />
  </PublishingCopyProvider>;
}
