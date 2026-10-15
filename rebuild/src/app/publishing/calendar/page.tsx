import { requireViewer } from "@/server/context";
import { listPosts } from "@/server/data";
import { PageHeading } from "../publishing-ui";
import styles from "../publishing.module.css";

const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default async function CalendarPage() {
  const viewer = await requireViewer({ feature: 'publishing/calendar', channelScoped: true });
  const timeZone = viewer.membership.workspace.timezone;
  const nowParts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "numeric" }).formatToParts(new Date());
  const year = Number(nowParts.find(part => part.type === "year")?.value);
  const month = Number(nowParts.find(part => part.type === "month")?.value) - 1;
  const rawPosts = await listPosts(viewer.workspaceId);
  const pageScope = viewer.permissions.pageScope;
  const posts = pageScope.all ? rawPosts : rawPosts.filter(post => post.targets.length > 0 && post.targets.every(item => pageScope.ids.includes(item.target.id)));
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstWeekday = new Date(year, month, 1).getDay();
  const cells = Math.ceil((firstWeekday + daysInMonth) / 7) * 7;
  const formatter = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
  const postsByDay = new Map<string, typeof posts>();
  for (const post of posts) {
    const date = post.scheduledAt ?? post.publishedAt;
    if (!date) continue;
    const key = formatter.format(date);
    postsByDay.set(key, [...(postsByDay.get(key) ?? []), post]);
  }
  for (const items of postsByDay.values()) items.sort((a, b) => (a.scheduledAt ?? a.publishedAt)!.getTime() - (b.scheduledAt ?? b.publishedAt)!.getTime());
  const monthLabel = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric", timeZone }).format(new Date(Date.UTC(year, month, 15, 12)));
  const monthPosts = [...postsByDay.entries()].filter(([key]) => key.startsWith(`${year}-${String(month + 1).padStart(2, '0')}`)).sort(([a], [b]) => a.localeCompare(b));
  return <><PageHeading title="Calendar" description="Posts with a scheduled or published date, shown in the workspace timezone." summary={monthLabel}/><div className={styles.calendar} role="grid" aria-label={`${monthLabel} publishing calendar`}>
    {weekdays.map(day => <div key={day} className={styles.weekday} role="columnheader">{day}</div>)}
    {Array.from({ length: cells }, (_, index) => {
      const day = index - firstWeekday + 1;
      const inMonth = day >= 1 && day <= daysInMonth;
      const date = new Date(year, month, Math.min(daysInMonth, Math.max(1, day)));
      const key = formatter.format(date);
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
      <ul>{items.map(post => <li key={post.id}><span className={styles.agendaStatus}>{post.status.replaceAll('_', ' ')} · <time dateTime={(post.scheduledAt ?? post.publishedAt)!.toISOString()}>{new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', timeZone }).format(post.scheduledAt ?? post.publishedAt!)}</time></span><p>{post.message.trim() || 'Untitled post'}</p></li>)}</ul>
    </div>) : <p className={styles.empty}>No scheduled or published posts this month.</p>}
  </section></>;
}
