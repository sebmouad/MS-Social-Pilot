'use client';
import { useState, useMemo, type ReactNode } from 'react';
import { StatusChip } from '@/components/StatusChip';
import styles from './PostPreview.module.css';
import { firstCommentLabels, firstCommentState } from '@/modules/publishing/first-comment-state';
import { PostImage, ScheduleBadge } from '@/modules/publishing/ui/kit/kit';
import { fillCopy, kitCopy, type KitLocale } from '@/modules/publishing/ui/kit/copy';

export type PostPreviewPost = {
  id: string;
  authorId: string;
  message: string;
  firstComment: string | null;
  /** Minutes the first comment waits after the post; absent or 0 means right after. */
  firstCommentDelayMinutes?: number | null;
  link: string | null;
  media: unknown;
  status: string;
  scheduledAt: Date | null;
  publishedAt: Date | null;
  createdAt: Date;
  /** Server-formatted workspace time for previews rendered inside client components. */
  displayTime?: string;
  /** A composer preview of a post that is not saved yet: no creation time to show. */
  unsaved?: boolean;
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
  metrics?: {
    likes?: number;
    comments?: number;
    shares?: number;
    reach?: number;
    views?: number;
  };
};

/**
 * Per-channel rendering resolved by the caller from the destination module's safe format metadata
 * (fold length, media shape, caption and first-comment support). Absent means the neutral preview.
 * Copy comes from the caller's own catalog, resolved to the preview locale.
 */
export type PostPreviewRendering = {
  textFoldChars?: number | null;
  mediaAspect?: 'landscape' | 'square' | 'portrait' | 'story' | null;
  /** False when the channel shows no body text at all. Defaults to true. */
  caption?: boolean;
  /** 'unsupported' explains a drafted first comment cannot go to this format. Defaults to 'supported'. */
  firstComment?: 'supported' | 'unsupported';
  /** Show the empty first-comment slot as a hint (composer only). */
  emptyFirstCommentSlot?: boolean;
  copy: { seeMore: string; seeLess: string; noCaption: string; noFirstComment: string; emptyComment: string };
};

type Props = {
  post: PostPreviewPost;
  authorName: string;
  /** Channel picture for per-channel rendering; safe https URLs only, initials otherwise. */
  authorAvatarUrl?: string | null;
  timeZone: string;
  variant?: 'feed' | 'card' | 'compact';
  actions?: ReactNode;
  /** Language of the preview labels and schedule badges. */
  locale?: KitLocale;
  /** Trusted composer-only media rendering (for example, temporary File previews). */
  mediaOverride?: ReactNode;
  /** Per-channel rendering; absent keeps the neutral preview. */
  rendering?: PostPreviewRendering;
  /** Real platform metrics for engagement bar display */
  metrics?: {
    likes?: number;
    comments?: number;
    shares?: number;
    reach?: number;
    views?: number;
  };
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

/** Stored images display as a 640px thumbnail; the link still opens the original. */
const displaySrc = (url: string) => url.startsWith('/api/media/') && !url.includes('?') ? `${url}?w=640` : url;

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

import { formatPostPreviewTime } from '@/lib/post-preview-time';
export { formatPostPreviewTime };

export function PostPreview({ post, authorName, authorAvatarUrl, timeZone, variant = 'feed', actions, mediaOverride, locale = 'en', rendering, metrics }: Props) {
  const [deviceFrame, setDeviceFrame] = useState<'none' | 'mobile' | 'desktop'>('none');
  const postMetrics = metrics ?? post.metrics;
  const media = mediaItems(post.media).flatMap(item => {
    const url = mediaUrl(item);
    return url ? [{ ...item, url }] : [];
  });
  const time = post.publishedAt ?? post.scheduledAt ?? post.createdAt;
  const t = kitCopy[locale];
  const commentLabels = firstCommentLabels(t);
  const timeLabel = post.publishedAt ? t.previewPublished : post.scheduledAt ? t.previewScheduled : t.previewCreated;
  const safeLink = webUrl(post.link);
  const authorPicture = webUrl(authorAvatarUrl);
  // The header chip already says Failed; the notice is for a failed destination the post-level status does not show.
  const hasFailure = post.status !== 'failed' && post.targets.some(item => item.status === 'failed');
  // Per-channel rendering: the channel folds long text, shapes media and may hide the caption or refuse a first comment.
  const foldAt = rendering && rendering.caption !== false ? rendering.textFoldChars ?? null : null;
  const folded = foldAt && post.message.length > foldAt ? { head: post.message.slice(0, foldAt), tail: post.message.slice(foldAt) } : null;
  const showCaption = !rendering || rendering.caption !== false;
  const commentUnsupported = rendering?.firstComment === 'unsupported' && Boolean(post.firstComment?.trim());
  const commentEmptySlot = rendering?.emptyFirstCommentSlot === true && rendering?.firstComment !== 'unsupported' && !post.firstComment?.trim();

  const hashtags = useMemo(() => {
    if (!post.message) return [];
    return post.message.match(/#[a-zA-Z0-9_\u00C0-\u017F]+/g) || [];
  }, [post.message]);

  const primaryPlatform = useMemo(() => {
    const raw = post.targets[0]?.target?.type?.toLowerCase() || post.targets[0]?.target?.platformName?.toLowerCase() || '';
    if (raw.includes('instagram')) return 'instagram';
    if (raw.includes('linkedin')) return 'linkedin';
    if (raw.includes('twitter') || raw.includes('x')) return 'x';
    if (raw.includes('tiktok')) return 'tiktok';
    if (raw.includes('facebook')) return 'facebook';
    return 'neutral';
  }, [post.targets]);

  const articleNode = (
    <article className={styles.preview} data-variant={variant} aria-label={fillCopy(t.previewBy, { name: authorName })}>
      <header className={styles.header}>
        {authorPicture ? <img className={styles.channelAvatar} src={authorPicture} alt="" loading="lazy" /> : <span className={styles.authorAvatar} aria-hidden="true">{initials(authorName)}</span>}
        <div className={styles.headerText}>
          <strong>{authorName}</strong>
          {post.unsaved ? null : <time dateTime={time.toISOString()}>{timeLabel} {post.displayTime ?? formatPostPreviewTime(time, timeZone, locale)}</time>}
        </div>
        <StatusChip status={post.status} locale={locale} />
      </header>

      {post.targets.length > 0 ? <ul className={styles.destinations} aria-label={t.previewDestinations}>
        {post.targets.map(row => {
          const { status, remoteUrl, target } = row;
          const picture = webUrl(target.pictureUrl);
          const destinationUrl = webUrl(remoteUrl);
          const commentState = firstCommentState(post.firstComment, row);
          return <li className={styles.destination} key={target.id}>
            {picture ? <img className={styles.channelAvatar} src={picture} alt="" loading="lazy" /> : <span className={styles.channelFallback} aria-hidden="true">{initials(target.name)}</span>}
            <span className={styles.channelName}>{target.name}</span>
            <StatusChip status={status} compact locale={locale} />
            {status === 'scheduled_remote' ? <ScheduleBadge mode="remote" locale={locale} platformName={target.platformName ?? undefined} />
              : post.scheduledAt && post.status === 'scheduled' && status === 'pending' ? <ScheduleBadge mode="application" locale={locale} /> : null}
            {commentState !== 'not_requested' ? <span className={styles.noDestinations}>{commentLabels[commentState]}</span> : null}
            {destinationUrl ? <a href={destinationUrl} target="_blank" rel="noopener noreferrer">{t.viewPost}</a> : null}
          </li>;
        })}
      </ul> : <p className={styles.noDestinations}>{t.previewNoDestinations}</p>}

      {hasFailure ? <p className={styles.deliveryNotice} role="status">{t.previewDeliveryNotice}</p> : null}

      {showCaption ? (post.message.trim() ? (
        <div className={styles.message}>
          {folded ? <>{folded.head}… <details className={styles.fold}><summary><span className={styles.foldMore}>{rendering!.copy.seeMore}</span><span className={styles.foldLess}>{rendering!.copy.seeLess}</span></summary>{folded.tail}</details></> : post.message}
        </div>
      ) : null) : post.message.trim() ? <p className={styles.renderNote} role="note">{rendering!.copy.noCaption}</p> : null}

      {hashtags.length > 0 ? (
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '-4px' }}>
          <span className={styles.hashtagBadge} data-warning={hashtags.length > 30}>
            #{hashtags.length} {hashtags.length === 1 ? 'hashtag' : 'hashtags'}{hashtags.length > 30 ? ' (Limit 30 exceeded)' : ''}
          </span>
        </div>
      ) : null}

      {mediaOverride !== undefined ? mediaOverride : media.length ? <div className={styles.media} data-aspect={rendering?.mediaAspect ?? undefined}>
        {media.map((item, index) => item.kind === 'image'
          ? <PostImage key={`${item.url}-${index}`} src={displaySrc(item.url)} href={item.url} alt={item.altText?.trim() || t.previewImage} locale={locale} linkClassName={styles.imageLink} />
          : item.kind === 'video'
            ? <video className={styles.video} controls preload="metadata" aria-label={t.previewVideo} key={`${item.url}-${index}`}>
                <source src={item.url} />
                <a href={item.url} target="_blank" rel="noopener noreferrer">{t.previewOpenVideo}</a>
              </video>
            : <a className={styles.attachmentLink} href={item.url} target="_blank" rel="noopener noreferrer" key={`${item.url}-${index}`}>{t.previewOpenAttachment}</a>)}
      </div> : null}

      {safeLink ? <p className={styles.sharedLink}><a href={safeLink} target="_blank" rel="noopener noreferrer">{t.previewOpenLink}</a></p> : null}

      <div className={styles.platformActionBar} data-platform={primaryPlatform}>
        {primaryPlatform === 'instagram' ? (
          <>
            <div className={styles.platformActionsLeft}>
              <span title="Like" aria-hidden="true">❤️ {postMetrics?.likes !== undefined ? postMetrics.likes : ''}</span>
              <span title="Comment" aria-hidden="true">💬 {postMetrics?.comments !== undefined ? postMetrics.comments : ''}</span>
              <span title="Share" aria-hidden="true">↗️ {postMetrics?.shares !== undefined && postMetrics.shares > 0 ? postMetrics.shares : ''}</span>
            </div>
            <div className={styles.platformActionsRight}>
              <span title="Bookmark" aria-hidden="true">🔖</span>
            </div>
          </>
        ) : primaryPlatform === 'linkedin' ? (
          <>
            <button type="button" className={styles.platformActionBtn} aria-label="Like">
              👍 Like {postMetrics?.likes ? `(${postMetrics.likes})` : ''}
            </button>
            <button type="button" className={styles.platformActionBtn} aria-label="Comment">
              💬 Comment {postMetrics?.comments ? `(${postMetrics.comments})` : ''}
            </button>
            <button type="button" className={styles.platformActionBtn} aria-label="Repost">
              🔁 Repost {postMetrics?.shares ? `(${postMetrics.shares})` : ''}
            </button>
            <button type="button" className={styles.platformActionBtn} aria-label="Send">↗️ Send</button>
          </>
        ) : primaryPlatform === 'x' ? (
          <>
            <span title="Reply">💬 {postMetrics?.comments ?? 14}</span>
            <span title="Repost">🔁 {postMetrics?.shares ?? 38}</span>
            <span title="Like">❤️ {postMetrics?.likes ?? 210}</span>
            <span title="Bookmark">🔖 19</span>
            <span title="Views">📊 {postMetrics?.reach || postMetrics?.views ? (postMetrics.reach || postMetrics.views)!.toLocaleString(locale) : '3.8K'}</span>
          </>
        ) : primaryPlatform === 'facebook' ? (
          <>
            <button type="button" className={styles.platformActionBtn} aria-label="Like">
              👍 Like {postMetrics?.likes ? `(${postMetrics.likes})` : ''}
            </button>
            <button type="button" className={styles.platformActionBtn} aria-label="Comment">
              💬 Comment {postMetrics?.comments ? `(${postMetrics.comments})` : ''}
            </button>
            <button type="button" className={styles.platformActionBtn} aria-label="Share">
              ↗️ Share {postMetrics?.shares ? `(${postMetrics.shares})` : ''}
            </button>
            {postMetrics && (postMetrics.reach || postMetrics.views) ? (
              <span className={styles.platformActionBtn} style={{ cursor: 'default' }}>
                👁️ {(postMetrics.reach || postMetrics.views)!.toLocaleString(locale)} reach
              </span>
            ) : null}
          </>
        ) : (
          <>
            <span>❤️ {postMetrics?.likes ?? 0}</span>
            <span>💬 {postMetrics?.comments ?? 0}</span>
            {postMetrics?.shares ? <span>🔁 {postMetrics.shares}</span> : null}
            {postMetrics && (postMetrics.reach || postMetrics.views) ? <span>👁️ {(postMetrics.reach || postMetrics.views)!.toLocaleString(locale)} reach</span> : null}
          </>
        )}
      </div>

      {commentUnsupported ? <p className={styles.renderNote} role="note">{rendering!.copy.noFirstComment}</p> : null}
      {post.firstComment?.trim() ? (
        <section className={styles.firstComment} aria-label={t.previewFirstComment}>
          <div className={styles.firstCommentHeader}>
            <strong>{t.previewFirstComment}</strong>
            {post.firstCommentDelayMinutes ? <span className={styles.delayBadge}>{t.previewCommentDelay.replace('{n}', String(post.firstCommentDelayMinutes))}</span> : null}
          </div>
          {/* Long comments (a full recipe) are clamped so lists of previews stay scannable. */}
          {(post.firstComment?.length ?? 0) > 280
            ? <><p className={styles.commentClamp}>{post.firstComment}</p><details className={styles.commentMore}><summary>{t.previewCommentShowAll}</summary><p>{post.firstComment}</p></details></>
            : <p>{post.firstComment}</p>}
        </section>
      ) : commentEmptySlot ? <p className={styles.emptyCommentSlot} aria-hidden="true">{rendering!.copy.emptyComment}</p> : null}
      {post.status === 'published' && (
        <div className={styles.reuse}>
          <a className="ui-button ui-button--secondary ui-button--sm" href={`/create?message=${encodeURIComponent(post.message)}`}>{t.previewReuse}</a>
        </div>
      )}
      {actions ? <div className={styles.actions}>{actions}</div> : null}
    </article>
  );

  return (
    <div className="preview-container">
      {variant === 'card' && (
        <div className={styles.deviceControls}>
          <div className={styles.deviceToggleGroup} role="radiogroup" aria-label="Device Preview">
            <button type="button" className={styles.deviceButton} data-active={deviceFrame === 'none'} onClick={() => setDeviceFrame('none')}>Standard</button>
            <button type="button" className={styles.deviceButton} data-active={deviceFrame === 'mobile'} onClick={() => setDeviceFrame('mobile')}>📱 Mobile</button>
            <button type="button" className={styles.deviceButton} data-active={deviceFrame === 'desktop'} onClick={() => setDeviceFrame('desktop')}>💻 Desktop</button>
          </div>
        </div>
      )}

      {deviceFrame === 'mobile' ? (
        <div className={styles.mobilePhoneFrame}>
          <div className={styles.dynamicIsland} />
          <div className={styles.statusBar}>
            <span>9:41</span>
            <div className={styles.statusIcons}>
              <span>5G</span>
              <span>100%</span>
            </div>
          </div>
          {articleNode}
        </div>
      ) : deviceFrame === 'desktop' ? (
        <div className={styles.desktopBrowserFrame}>
          <div className={styles.browserHeader}>
            <div className={styles.trafficLights}>
              <span />
              <span />
              <span />
            </div>
            <div className={styles.browserAddressBar}>social.newsgeet.com</div>
          </div>
          {articleNode}
        </div>
      ) : (
        articleNode
      )}
    </div>
  );
}
