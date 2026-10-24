'use client';
import { usePublishingCopy } from '../kit/CopyProvider';
import { StatusChip } from '@/components';
import { IconMessageCircle, IconShare, IconThumbUp } from '@tabler/icons-react';
import type { PostPerformanceMetrics } from '../../server/post-reach';
import { postContentSummary } from '@/modules/publishing/content-summary';
import { AttentionHint, AvatarStack, MediaThumb, ScheduleBadge, isSafeImageUrl } from '../kit/kit';
import { type KitLocale } from '../kit/copy';
import { OriginBadge } from '../origins/OriginBadge';
import type { PostOriginView } from '../origins/post-origin';
import styles from './posts-table.module.css';

type Media = { kind: string; url: string; altText?: string };
type Row = {
  message: string; link: string | null; media: unknown; status: string;
  scheduledAt: Date | null; publishedAt: Date | null;
  origin?: PostOriginView | null;
  targets: Array<{ status: string; target: { id: string; name: string; pictureUrl: string | null; platformName?: string | null } }>;
};

const MEDIA_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function mediaList(value: unknown): Media[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(item => item && typeof item === 'object' && typeof (item as Media).kind === 'string' && typeof (item as Media).url === 'string' ? [item as Media] : []);
}

function thumbUrl(item: Media | undefined) {
  if (!item || item.kind !== 'image') return null;
  if (item.url.startsWith('media:')) { const id = item.url.slice(6); return MEDIA_ID.test(id) ? `/api/media/${encodeURIComponent(id)}` : null; }
  return isSafeImageUrl(item.url) ? item.url : null;
}

/** Safe thumbnail address of a post's first media item, or null. */
export function postThumbUrl(media: unknown) { return thumbUrl(mediaList(media)[0]); }

/** Thumbnail, text summary and attachment count for one post row. */
export function PostCell({ post, locale = 'en' }: { post: Row; locale?: KitLocale }) {
  const media = mediaList(post.media);
  const first = media[0];
  const copy = usePublishingCopy(locale);
  return <div className={styles.cell}>
    <MediaThumb url={thumbUrl(first)} alt={first?.altText?.trim() || ''} count={media.length} video={first?.kind === 'video'} locale={locale} />
    <div className={styles.cellText}>
      <span className={styles.message}>{postContentSummary(post.message, post.media, post.link, copy) || copy.noText}</span>
      {media.length ? <span className={styles.sub}>{media.length} {copy.mediaCount}</span> : null}
      {post.origin ? <OriginBadge origin={post.origin} /> : null}
    </div>
  </div>;
}

/** Stored reach and real platform metrics for one post row; an em dash when no destination has measured it yet. */
export function ReachCell({ reach, locale = 'en' }: { reach?: PostPerformanceMetrics | { value: number | null; measured: number } | null; locale?: KitLocale }) {
  const copy = usePublishingCopy(locale);
  if (!reach || (reach.value === null && reach.measured === 0)) {
    return <span className={styles.emptyMetric} aria-label={copy.reachUnavailable}>—</span>;
  }

  const metrics = reach as Partial<PostPerformanceMetrics>;
  const likes = metrics.likes ?? 0;
  const comments = metrics.comments ?? 0;
  const shares = metrics.shares ?? 0;
  const reachVal = metrics.reach ?? metrics.value ?? 0;
  const views = metrics.views ?? 0;

  const hasAnyData = reach.measured > 0 || reachVal > 0 || likes > 0 || comments > 0 || shares > 0 || views > 0;
  if (!hasAnyData && reach.value === null) {
    return <span className={styles.emptyMetric} aria-label={copy.reachUnavailable}>—</span>;
  }

  const titleText = `${reachVal.toLocaleString(locale)} reach · ${likes.toLocaleString(locale)} likes · ${comments.toLocaleString(locale)} comments · ${shares.toLocaleString(locale)} shares${views > 0 ? ` · ${views.toLocaleString(locale)} views` : ''}`;

  return (
    <div className={styles.metricsCell} title={titleText}>
      <div className={styles.reachPrimary}>
        <span className={styles.reachNumber}>{reachVal.toLocaleString(locale)}</span>
        <span className={styles.reachLabel}>reach</span>
      </div>
      {(likes > 0 || comments > 0 || shares > 0) && (
        <div className={styles.metricBadges}>
          {likes > 0 && (
            <span className={styles.metricBadge} title={`${likes.toLocaleString(locale)} likes / reactions`}>
              <IconThumbUp size={11} aria-hidden="true" />
              <span>{likes.toLocaleString(locale)}</span>
            </span>
          )}
          {comments > 0 && (
            <span className={styles.metricBadge} title={`${comments.toLocaleString(locale)} comments`}>
              <IconMessageCircle size={11} aria-hidden="true" />
              <span>{comments.toLocaleString(locale)}</span>
            </span>
          )}
          {shares > 0 && (
            <span className={styles.metricBadge} title={`${shares.toLocaleString(locale)} shares`}>
              <IconShare size={11} aria-hidden="true" />
              <span>{shares.toLocaleString(locale)}</span>
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export function ChannelsCell({ post, locale = 'en' }: { post: Row; locale?: KitLocale }) {
  const seen = new Map<string, { id: string; name: string; pictureUrl: string | null }>();
  for (const { target } of post.targets) if (!seen.has(target.id)) seen.set(target.id, target);
  return <AvatarStack channels={[...seen.values()]} locale={locale} />;
}

/** The platform names holding a post remotely, from the read model; empty when the module metadata is unknown. */
export { remotePlatformName } from '../remote-platform-name';
import { remotePlatformName } from '../remote-platform-name';

/** Overall status plus the per-destination outcome summary and who schedules it. */
export function StatusCell({ post, locale = 'en' }: { post: Row; locale?: KitLocale }) {
  const remote = post.targets.some(row => row.status === 'scheduled_remote');
  const scheduled = post.status === 'scheduled' || remote;
  const failed = post.targets.filter(row => row.status === 'failed').length;
  const done = post.targets.filter(row => row.status === 'published').length;
  return <div className={styles.statusCell}>
    <StatusChip status={post.status} />
    {scheduled ? <ScheduleBadge mode={remote ? 'remote' : 'application'} locale={locale} platformName={remote ? remotePlatformName(post) : undefined} /> : null}
    {post.targets.length > 1 && (failed || done) ? <span className={styles.sub}>{done}/{post.targets.length}</span> : null}
    {failed ? <AttentionHint locale={locale} /> : null}
  </div>;
}
