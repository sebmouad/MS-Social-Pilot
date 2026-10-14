import { requireViewer } from "@/server/context";
import { listPosts } from "@/server/data";
import { PageHeading } from "../publishing-ui";
import styles from "../publishing.module.css";

const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default async function CalendarPage() {
  const viewer = await requireViewer({ feature: 'publishing/calendar' });
  const timeZone = viewer.membership.workspace.timezone;
  const nowParts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "numeric" }).formatToParts(new Date());
  const year = Number(nowParts.find(part => part.type === "year")?.value);
  const month = Number(nowParts.find(part => part.type === "month")?.value) - 1;
  const posts = await listPosts(viewer.workspaceId);
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
  const monthLabel = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric", timeZone }).format(new Date(Date.UTC(year, month, 15, 12)));
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
  </div></>;
}
