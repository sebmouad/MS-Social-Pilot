import { requireViewer } from "@/server/context";
import { listCalendarPosts } from "@/server/data";
import { PageHeading } from "../publishing-ui";
import { adjacentCalendarMonth, calendarMonth, postCalendarDate, workspaceDateKey } from "@/lib/calendar-dates";
import styles from "../publishing.module.css";

const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const viewer = await requireViewer({ feature: 'publishing/calendar', channelScoped: true });
  const timeZone = viewer.membership.workspace.timezone;
  const { month: monthParam } = await searchParams;
  const selected = calendarMonth(monthParam, new Date(), timeZone);
  const { year } = selected;
  const month = selected.month - 1;
  const pageScope = viewer.permissions.pageScope;
  const broadPosts = await listCalendarPosts(viewer.workspaceId, year, selected.month, pageScope.all ? null : pageScope.ids, viewer.user.id);
  const posts = broadPosts.filter(post => {
    const date = postCalendarDate(post);
    return date && workspaceDateKey(date, timeZone).startsWith(selected.key);
  });
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstWeekday = new Date(year, month, 1).getDay();
  const cells = Math.ceil((firstWeekday + daysInMonth) / 7) * 7;
  const postsByDay = new Map<string, typeof posts>();
  for (const post of posts) {
    const date = postCalendarDate(post);
    if (!date) continue;
    const key = workspaceDateKey(date, timeZone);
    postsByDay.set(key, [...(postsByDay.get(key) ?? []), post]);
  }
  for (const items of postsByDay.values()) items.sort((a, b) => postCalendarDate(a)!.getTime() - postCalendarDate(b)!.getTime());
  const monthLabel = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric", timeZone }).format(new Date(Date.UTC(year, month, 15, 12)));
  const monthPosts = [...postsByDay.entries()].sort(([a], [b]) => a.localeCompare(b));
  return <><PageHeading title="Calendar" description="Posts with a scheduled or published date, shown in the workspace timezone." summary={monthLabel}/><nav className={styles.calendarNavigation} aria-label="Calendar months"><a href={`/publishing/calendar?month=${adjacentCalendarMonth(year, selected.month, -1)}`}>Previous month</a><span>{monthLabel}</span><a href={`/publishing/calendar?month=${adjacentCalendarMonth(year, selected.month, 1)}`}>Next month</a></nav><div className={styles.calendar} role="grid" aria-label={`${monthLabel} publishing calendar`}>
    {weekdays.map(day => <div key={day} className={styles.weekday} role="columnheader">{day}</div>)}
    {Array.from({ length: cells }, (_, index) => {
      const day = index - firstWeekday + 1;
      const inMonth = day >= 1 && day <= daysInMonth;
      const key = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const dayPosts = inMonth ? postsByDay.get(key) ?? [] : [];
      return <div key={index} className={`${styles.day}${inMonth ? "" : ` ${styles.outside}`}`} role="gridcell" aria-label={inMonth ? `${monthLabel} ${day}, ${dayPosts.length} posts` : undefined}>
        <div className={styles.dayNumber}>{inMonth ? day : ""}</div>
        {dayPosts.slice(0, 3).map(post => <div key={post.id} className={styles.event} data-status={post.status} title={post.message}>{post.message.trim().slice(0, 70) || "Untitled post"}</div>)}
        {dayPosts.length > 3 ? <span className={styles.summary}>+{dayPosts.length - 3} more</span> : null}
      </div>;
    })}
  </div><section className={styles.agenda} aria-label={`${monthLabel} publishing agenda`}>
    <h2>{monthLabel} agenda</h2>
    {monthPosts.length ? monthPosts.map(([day, items]) => <div className={styles.agendaDay} key={day}>
      <h3><time dateTime={day}>{new Intl.DateTimeFormat(undefined, { month: 'long', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${day}T12:00:00Z`))}</time></h3>
      <ul>{items.map(post => <li key={post.id}><span className={styles.agendaStatus}>{post.status.replaceAll('_', ' ')} · <time dateTime={postCalendarDate(post)!.toISOString()}>{new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', timeZone }).format(postCalendarDate(post)!)}</time></span><p>{post.message.trim() || 'Untitled post'}</p></li>)}</ul>
    </div>) : <p className={styles.empty}>No scheduled or published posts this month.</p>}
  </section></>;
}
