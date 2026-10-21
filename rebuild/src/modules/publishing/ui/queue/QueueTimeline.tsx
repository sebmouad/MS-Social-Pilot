'use client';
import { usePublishingCopy } from '../kit/CopyProvider';
import { Avatar, ScheduleBadge } from '../kit/kit';
import { type KitLocale } from '../kit/copy';
import { remotePlatformName } from '../remote-platform-name';
import { postContentSummary } from '@/modules/publishing/content-summary';
import styles from './queue.module.css';

type TimelinePost = {
  id: string; message: string; link: string | null; media: unknown; status: string; scheduledAt: Date | null;
  targets: Array<{ status: string; target: { id: string; name: string; pictureUrl: string | null; platformName?: string | null } }>;
};

/** The scheduled posts on this page, grouped under each channel they will publish to, soonest first. */
export function groupByChannel(posts: TimelinePost[]) {
  const channels = new Map<string, { id: string; name: string; pictureUrl: string | null; posts: TimelinePost[] }>();
  for (const post of posts) {
    for (const { target } of post.targets) {
      const entry = channels.get(target.id) ?? { id: target.id, name: target.name, pictureUrl: target.pictureUrl, posts: [] };
      if (!entry.posts.includes(post)) entry.posts.push(post);
      channels.set(target.id, entry);
    }
  }
  return [...channels.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Upcoming slots per channel. Times are formatted by the server in the workspace time zone. */
export function QueueTimeline({ posts, timeZone, locale = 'en', maxPerChannel }: { posts: TimelinePost[]; timeZone: string; locale?: KitLocale; maxPerChannel: number }) {
  const copy = usePublishingCopy(locale);
  const channels = groupByChannel(posts);
  const time = new Intl.DateTimeFormat(locale, { timeZone, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  return <div className={styles.channels}>
    {channels.map(channel => {
      const shown = channel.posts.slice(0, maxPerChannel);
      const extra = channel.posts.length - shown.length;
      return <section key={channel.id} className={styles.channel} aria-labelledby={`queue-channel-${channel.id}`}>
        <header className={styles.channelHead}><Avatar name={channel.name} src={channel.pictureUrl} size={28} /><h3 id={`queue-channel-${channel.id}`}>{channel.name}</h3></header>
        <ol className={styles.slots} aria-label={`${copy.queueTimeline} ${channel.name}`}>
          {shown.map(post => {
            const remote = post.targets.some(row => row.target.id === channel.id && row.status === 'scheduled_remote');
            const platformName = remote ? remotePlatformName({ targets: post.targets.filter(row => row.target.id === channel.id) }) : undefined;
            return <li key={post.id} className={styles.slot}>
              <time className={styles.slotTime} dateTime={post.scheduledAt?.toISOString()}>{post.scheduledAt ? time.format(post.scheduledAt) : copy.queueUnscheduled}</time>
              <span className={styles.slotText}>{postContentSummary(post.message, post.media, post.link, copy) || copy.noText}</span>
              <ScheduleBadge mode={remote ? 'remote' : 'application'} locale={locale} platformName={platformName} />
            </li>;
          })}
        </ol>
        {extra > 0 ? <p className={styles.more}>{copy.queueMore(extra)}</p> : null}
      </section>;
    })}
    {!channels.length ? <p className={styles.more}>{copy.queueNoUpcoming}</p> : null}
  </div>;
}
