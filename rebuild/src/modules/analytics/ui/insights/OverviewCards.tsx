import { IconAlertTriangle, IconCalendarEvent, IconSend } from '@tabler/icons-react';
import { InfoTip, PostThumb } from '@/components';
import { EmptyState } from '@/components/EmptyState';
import type { InsightsCopy } from './insights-config';
import { fillInsights } from './insights-config';
import './insights.css';

export type TopPostItem = {
  key: string; text: string; channelName: string; url: string | null; value: string | null; measure: string | null;
};

/** Top posts card (design v2 S9 row 3): thumbnail slot, text, channel, the ranking measure and a link to the post. */
export function TopPostsCard({ copy, posts, infoText, allHref, unavailable }: { copy: InsightsCopy; posts: TopPostItem[]; infoText: string; allHref?: string; unavailable: boolean }) {
  return <section className="insights-card" aria-labelledby="insights-top-posts">
    <div className="insights-card__head">
      <h2 id="insights-top-posts" className="insights-card__title">{copy.topPostsTitle}<InfoTip name={copy.topPostsTitle} blocks={[{ text: infoText }]} /></h2>
      {allHref && <a className="insights-card__link" href={allHref}>{copy.topPostsAll}</a>}
    </div>
    {posts.length
      ? <ol className="insights-posts">{posts.map(post => <li key={post.key} className="insights-post">
        <PostThumb thumb={null} size="sm" />
        <div className="insights-post__text">
          <strong title={post.text}>{post.text || copy.topPostsNoText}</strong>
          <small>{post.channelName}{post.url ? <> · <a href={post.url} target="_blank" rel="noreferrer">{copy.postViewOnChannel}</a></> : null}</small>
        </div>
        <div className="insights-post__value">{post.value ?? '—'}{post.measure && <small>{post.measure}</small>}</div>
      </li>)}</ol>
      : <EmptyState title={copy.topPostsEmpty}>{unavailable ? copy.topPostsUnavailable : copy.topPostsEmptyBody}</EmptyState>}
  </section>;
}

/** Publishing activity card: counts with links into Content filtered the same way. */
export function PublishingActivityCard({ copy, counts, hrefs }: {
  copy: InsightsCopy;
  counts: { published: number; scheduled: number; failed: number };
  hrefs: { published: string; scheduled: string; failed: string };
}) {
  const rows = [
    { id: 'published', label: copy.activityPublished, value: counts.published, href: hrefs.published, icon: <IconSend size={18} stroke={1.8} aria-hidden="true" /> },
    { id: 'scheduled', label: copy.activityScheduled, value: counts.scheduled, href: hrefs.scheduled, icon: <IconCalendarEvent size={18} stroke={1.8} aria-hidden="true" /> },
    { id: 'failed', label: copy.activityFailed, value: counts.failed, href: hrefs.failed, icon: <IconAlertTriangle size={18} stroke={1.8} aria-hidden="true" /> },
  ];
  return <section className="insights-card" aria-labelledby="insights-activity">
    <div className="insights-card__head">
      <h2 id="insights-activity" className="insights-card__title">{copy.activityTitle}<InfoTip name={copy.activityTitle} blocks={[{ text: copy.activityInfo }]} /></h2>
    </div>
    <ul className="insights-activity">{rows.map(row => <li key={row.id}>
      <a href={row.href} aria-label={`${row.label}: ${row.value}. ${copy.activityOpen}`}><span>{row.icon} {row.label}</span><strong>{new Intl.NumberFormat().format(row.value)}</strong></a>
    </li>)}</ul>
  </section>;
}

export type GoalBar = { key: string; label: string; percent: number };

/** Goal progress bars (design v2 S9 row 4), shown only when the month has goals. */
export function GoalsCard({ copy, goals, href }: { copy: InsightsCopy; goals: GoalBar[]; href: string }) {
  if (!goals.length) return null;
  return <section className="insights-card" aria-labelledby="insights-goals">
    <div className="insights-card__head">
      <h2 id="insights-goals" className="insights-card__title">{copy.goalsSectionTitle}</h2>
      <a className="insights-card__link" href={href}>{copy.goalsAll}</a>
    </div>
    <ul className="insights-goals">{goals.map(goal => <li key={goal.key}>
      <label>{fillInsights(copy.goalsProgress, { label: goal.label, percent: goal.percent })}<progress max={100} value={Math.min(100, goal.percent)} /></label>
    </li>)}</ul>
  </section>;
}
