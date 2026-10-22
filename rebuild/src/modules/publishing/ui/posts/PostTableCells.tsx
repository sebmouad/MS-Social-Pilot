'use client';
import { usePublishingCopy } from '../kit/CopyProvider';
import { StatusChip } from '@/components';
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
