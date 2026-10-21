import type { ReactNode } from 'react';
import { StatusChip } from '@/components/StatusChip';
import styles from './PostPreview.module.css';
import { FIRST_COMMENT_LABELS, firstCommentState } from '@/modules/publishing/first-comment-state';
import { PostImage, ScheduleBadge } from '@/modules/publishing/ui/kit/kit';
import type { KitLocale } from '@/modules/publishing/ui/kit/copy';

export type PostPreviewPost = {
  id: string;
  authorId: string;
  message: string;
  firstComment: string | null;
  link: string | null;
  media: unknown;
  status: string;
  scheduledAt: Date | null;
  publishedAt: Date | null;
  createdAt: Date;
  /** Server-formatted workspace time for previews rendered inside client components. */
  displayTime?: string;
  targets: Array<{
    id?: string;
    status: string;
    remotePostId: string | null;
    remoteUrl: string | null;
    firstCommentId?: string | null;
    firstCommentAt?: Date | string | null;
    firstCommentError?: string | null;
    /** platformName is the installed module's customer-facing name, added by the Publishing read model. */
    target: { id: string; type: string; name: string; pictureUrl: string | null; platformName?: string | null };
  }>;
};

type Props = {
  post: PostPreviewPost;
  authorName: string;
  timeZone: string;
  variant?: 'feed' | 'card';
  actions?: ReactNode;
  /** Language of the schedule badges; the surrounding labels are still English. */
  locale?: KitLocale;
  /** Trusted composer-only media rendering (for example, temporary File previews). */
  mediaOverride?: ReactNode;
};

type MediaItem = { kind: string; url: string; altText?: string };
const MEDIA_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function webUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

function mediaItems(value: unknown): MediaItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(item => {
    if (!item || typeof item !== 'object') return [];
    const media = item as Record<string, unknown>;
    if (typeof media.kind !== 'string' || typeof media.url !== 'string') return [];
    return [{ kind: media.kind, url: media.url, ...(typeof media.altText === 'string' ? { altText: media.altText } : {}) }];
  });
}

function mediaUrl(item: MediaItem): string | null {
  if (item.kind === 'image' && item.url.startsWith('media:')) {
    const id = item.url.slice('media:'.length);
    return MEDIA_ID.test(id) ? `/api/media/${encodeURIComponent(id)}` : null;
  }
  return webUrl(item.url);
}

function initials(value: string) {
  return value.trim().split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]?.toUpperCase()).join('') || '?';
}

export function formatPostPreviewTime(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat('en-US', { timeZone, dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

export function PostPreview({ post, authorName, timeZone, variant = 'feed', actions, mediaOverride, locale = 'en' }: Props) {
  const media = mediaItems(post.media).flatMap(item => {
    const url = mediaUrl(item);
    return url ? [{ ...item, url }] : [];
  });
  const time = post.publishedAt ?? post.scheduledAt ?? post.createdAt;
  const timeLabel = post.publishedAt ? 'Published' : post.scheduledAt ? 'Scheduled' : 'Created';
  const safeLink = webUrl(post.link);
  const hasFailure = post.status === 'failed' || post.status === 'partially_failed' || post.targets.some(item => item.status === 'failed');

  return <article className={styles.preview} data-variant={variant} aria-label={`Post by ${authorName}`}>
    <header className={styles.header}>
      <span className={styles.authorAvatar} aria-hidden="true">{initials(authorName)}</span>
      <div className={styles.headerText}>
        <strong>{authorName}</strong>
        <time dateTime={time.toISOString()}>{timeLabel} {post.displayTime ?? formatPostPreviewTime(time, timeZone)}</time>
      </div>
      <StatusChip status={post.status} />
    </header>

    {post.targets.length > 0 ? <ul className={styles.destinations} aria-label="Destinations">
      {post.targets.map(row => {
        const { status, remoteUrl, target } = row;
        const picture = webUrl(target.pictureUrl);
        const destinationUrl = webUrl(remoteUrl);
        const commentState = firstCommentState(post.firstComment, row);
        return <li className={styles.destination} key={target.id}>
          {picture ? <img className={styles.channelAvatar} src={picture} alt="" loading="lazy" /> : <span className={styles.channelFallback} aria-hidden="true">{initials(target.name)}</span>}
          <span className={styles.channelName}>{target.name}</span>
          <StatusChip status={status} compact />
          {status === 'scheduled_remote' ? <ScheduleBadge mode="remote" locale={locale} platformName={target.platformName ?? undefined} />
            : post.scheduledAt && post.status === 'scheduled' && status === 'pending' ? <ScheduleBadge mode="application" locale={locale} /> : null}
          {commentState !== 'not_requested' ? <span className={styles.noDestinations}>{FIRST_COMMENT_LABELS[commentState]}</span> : null}
          {destinationUrl ? <a href={destinationUrl} target="_blank" rel="noopener noreferrer">View post</a> : null}
        </li>;
      })}
    </ul> : <p className={styles.noDestinations}>No destinations selected</p>}

    {hasFailure ? <p className={styles.deliveryNotice} role="status">Delivery needs attention. Review the destination statuses above.</p> : null}

    {post.message.trim() ? <div className={styles.message}>{post.message}</div> : null}

    {mediaOverride !== undefined ? mediaOverride : media.length ? <div className={styles.media}>
      {media.map((item, index) => item.kind === 'image'
        ? <PostImage key={`${item.url}-${index}`} src={item.url} href={item.url} alt={item.altText?.trim() || 'Post image'} locale={locale} linkClassName={styles.imageLink} />
        : item.kind === 'video'
          ? <video className={styles.video} controls preload="metadata" aria-label="Video attachment" key={`${item.url}-${index}`}>
              <source src={item.url} />
              <a href={item.url} target="_blank" rel="noopener noreferrer">Open video attachment</a>
            </video>
          : <a className={styles.attachmentLink} href={item.url} target="_blank" rel="noopener noreferrer" key={`${item.url}-${index}`}>Open attachment</a>)}
    </div> : null}

    {safeLink ? <p className={styles.sharedLink}><a href={safeLink} target="_blank" rel="noopener noreferrer">Open shared link</a></p> : null}
    {post.firstComment?.trim() ? <section className={styles.firstComment} aria-label="First comment"><strong>First comment</strong><p>{post.firstComment}</p></section> : null}
    {actions ? <div className={styles.actions}>{actions}</div> : null}
  </article>;
}
