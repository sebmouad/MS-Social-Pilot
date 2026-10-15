import { requireViewer } from "@/server/context";
import { getTargets, listCalendarRange } from "@/server/data";
import { canAccessFeature } from "@/server/permissions";
import { PageHeading } from "../publishing-ui";
import { adjacentCalendarMonth, addDaysToKey, calendarMonth, isDateKey, postCalendarDate, weekStartKey, weekdayOfKey, workspaceDateKey } from "@/lib/calendar-dates";
import { channelBadgeInfo } from "@/lib/channel-badge";
import { CalendarBoard } from "./CalendarBoard";
import type { BoardDay, BoardPost } from "./types";
import styles from "./calendar.module.css";

type Params = { view?: string; date?: string; month?: string; channel?: string; status?: string };
const STATUSES = ["draft", "pending_approval", "rejected", "scheduled", "publishing", "published", "partially_failed", "failed", "cancelled"] as const;
const MANAGERS = new Set(["owner", "admin", "editor"]);
const DAY = 24 * 60 * 60 * 1000;

const utcNoon = (key: string) => new Date(`${key}T12:00:00Z`);
const formatUtc = (key: string, options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" }).format(utcNoon(key));

export default async function CalendarPage({ searchParams }: { searchParams: Promise<Params> }) {
  const viewer = await requireViewer({ feature: "publishing/calendar", channelScoped: true });
  const timeZone = viewer.membership.workspace.timezone;
  const params = await searchParams;
  const now = new Date();
  const today = workspaceDateKey(now, timeZone);
  const view = params.view === "week" ? "week" : "month";
  const month = params.month && /^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(params.month) ? params.month : undefined;
  const anchor = isDateKey(params.date) ? params.date : month ? (month === today.slice(0, 7) ? today : `${month}-01`) : today;

  const pageScope = viewer.permissions.pageScope;
  const allowedIds = pageScope.all ? null : pageScope.ids;
  const channels = (await getTargets(viewer.workspaceId)).filter(target => allowedIds === null || allowedIds.includes(target.id));
  const channelId = channels.some(channel => channel.id === params.channel) ? params.channel : undefined;
  const status = (STATUSES as readonly string[]).includes(params.status ?? "") ? params.status as (typeof STATUSES)[number] : undefined;

  // The days on screen: a whole month grid (weeks start on Sunday) or one week.
  const selected = calendarMonth(anchor.slice(0, 7), now, timeZone);
  const firstOfMonth = `${selected.key}-01`;
  const daysInMonth = new Date(Date.UTC(selected.year, selected.month, 0)).getUTCDate();
  const gridStart = view === "week" ? weekStartKey(anchor) : weekStartKey(firstOfMonth);
  const count = view === "week" ? 7 : Math.ceil((weekdayOfKey(firstOfMonth) + daysInMonth) / 7) * 7;
  const keys = Array.from({ length: count }, (_, index) => addDaysToKey(gridStart, index));

  const from = new Date(utcNoon(keys[0]!).getTime() - 2 * DAY);
  const to = new Date(utcNoon(keys[keys.length - 1]!).getTime() + 2 * DAY);
  const posts = await listCalendarRange(viewer.workspaceId, from, to, allowedIds, viewer.user.id, { channelId, status });

  const canEditCalendar = canAccessFeature(viewer.permissions, "publishing/calendar", "write");
  const canCreate = canAccessFeature(viewer.permissions, "publishing/posts", "write");
  const byDay = new Map<string, BoardPost[]>();
  for (const post of posts) {
    const when = postCalendarDate(post);
    if (!when) continue;
    const key = workspaceDateKey(when, timeZone);
    const channelsOfPost = [...new Map(post.targets.map(({ target }) => [target.id, { id: target.id, name: target.name, ...channelBadgeInfo(target.socialAccount?.provider) }])).values()];
    const movable = canEditCalendar && post.status === "scheduled" && post.targets.length > 0 && post.targets.every(target => target.status === "pending" && !target.remotePostId)
      && (MANAGERS.has(viewer.membership.role) || post.authorId === viewer.user.id);
    byDay.set(key, [...(byDay.get(key) ?? []), { id: post.id, text: post.message.trim().slice(0, 240), status: post.status, whenIso: when.toISOString(), channels: channelsOfPost, movable }]);
  }
  const days: BoardDay[] = keys.map(key => ({
    key,
    label: formatUtc(key, { weekday: "short", day: "numeric" }),
    longLabel: formatUtc(key, { weekday: "long", month: "long", day: "numeric" }),
    inMonth: key.startsWith(selected.key),
    isToday: key === today,
    isPast: key < today,
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

  return <>
    <PageHeading title="Calendar" description="Plan, check and reschedule posts in your workspace time zone." />
    <div className={styles.toolbar}>
      <nav className={styles.nav} aria-label={`Calendar ${unit}s`}>
        <a className="ui-button ui-button--secondary ui-button--md" href={href(view, previous)}>Previous<span className="ui-visually-hidden"> {unit}</span></a>
        <a className="ui-button ui-button--secondary ui-button--md" href={href(view, today)}>Today</a>
        <a className="ui-button ui-button--secondary ui-button--md" href={href(view, next)}>Next<span className="ui-visually-hidden"> {unit}</span></a>
        <h2 className={styles.range} aria-live="polite">{rangeLabel}</h2>
      </nav>
      <div className={styles.toolbarEnd}>
      {canCreate && <a className="ui-button ui-button--primary ui-button--md" href="/publishing/compose">New post</a>}
      <nav className={styles.switch} aria-label="Calendar view">
        <a href={href("month", anchor)} aria-current={view === "month" ? "page" : undefined}>Month</a>
        <a href={href("week", anchor)} aria-current={view === "week" ? "page" : undefined}>Week</a>
      </nav>
      </div>
    </div>
    <CalendarBoard view={view} days={days} timeZone={timeZone} nowIso={now.toISOString()} canCreate={canCreate} filterQuery={filterQuery} />
  </>;
}
