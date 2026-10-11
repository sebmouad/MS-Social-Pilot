import Link from 'next/link';
import type { ReactNode } from 'react';

import { ExternalLink } from './ExternalLink';
import { Icon } from './Icon';

/** One attachment, as the feed draws it. */
export interface FeedMedia {
  kind: 'image' | 'video';
  /** The file itself. A video without one is drawn from its poster. */
  url?: string | null;
  /** A video's still: Facebook's thumbnail for a video posted there. */
  poster?: string | null;
  alt?: string | null;
}

/** Facebook's link card: what the scraper found at the address. */
export interface FeedLinkPreview {
  url: string;
  title?: string | null;
  description?: string | null;
  imageUrl?: string | null;
  siteName?: string | null;
}

/**
 * Facebook draws a short status with nothing attached in large type; past
 * this many characters, or with a photo, a video or a link, it is body text.
 */
export const LARGE_TEXT_MAX = 85;
/** Past this, or this many lines, the feed cuts the caption at "See more". */
const SEE_MORE_CHARS = 240;
const SEE_MORE_LINES = 5;

/**
 * A post as Facebook draws it in the feed: the Page's photo and name, when it
 * went out, the text, then whatever it carries — a photo grid, a video, a link
 * card — then the counts and the first comment.
 *
 * One component for every screen that shows a post, so a post reads the same
 * wherever it turns up, and looks like what the Page's followers see.
 *
 * Neither a server nor a client component: it takes its words as props and
 * holds no state, so both kinds of screen can use it.
 */
export function FeedPost({
  author,
  meta,
  badge,
  message,
  emptyText,
  clamp = false,
  seeMore,
  href,
  images = [],
  media,
  link,
  linkPreview,
  mediaHref,
  stats,
  comment,
  footer,
  compact = false,
  as: Tag = 'article',
  className = '',
}: {
  /** The Page it went, or goes, to. Several Pages read as one name list. */
  author: { name: string; pictureUrl: string | null };
  /** The line under the name: when, and anything else worth one glance. */
  meta: ReactNode;
  /** A status pill or a rank, at the top right. */
  badge?: ReactNode;
  message: string;
  /** What to say when there is no text: a photo-only post, say. */
  emptyText: string;
  /** Cut long text to a few lines, as the feed does before "See more". */
  clamp?: boolean;
  /** The "See more" words, shown under a caption the clamp cuts. */
  seeMore?: string;
  /** Where the text leads: the post's own report, the composer. */
  href?: string;
  /** Photos only; `media` takes photos and videos alike. */
  images?: Array<{ url: string; alt?: string | null }>;
  media?: FeedMedia[];
  link?: string | null;
  linkPreview?: FeedLinkPreview | null;
  /** Where a video drawn from its poster plays: the post on Facebook. */
  mediaHref?: string | null;
  /** Reactions on the left, the rest written out on the right. */
  stats?: { reactions: number; others: string[] };
  /** The first comment, drawn as the Page's reply under the post. */
  comment?: { text: string; note?: ReactNode };
  /** Actions under the post, Facebook's Like · Comment · Share row. */
  footer?: ReactNode;
  /** Smaller type and photo, for side columns and grids. */
  compact?: boolean;
  /** A `div` when the post sits inside a larger card that is the article. */
  as?: 'article' | 'div';
  className?: string;
}) {
  const text = message.trim();
  const attachments: FeedMedia[] = media ?? images.map((image) => ({ kind: 'image', url: image.url, alt: image.alt }));
  const preview = linkPreview ?? (link ? { url: link } : null);
  const large = text.length > 0 && text.length <= LARGE_TEXT_MAX && attachments.length === 0 && !preview;
  const cut = clamp && (text.length > SEE_MORE_CHARS || text.split('\n').length > SEE_MORE_LINES);

  const body = (
    <p
      className={`whitespace-pre-wrap [overflow-wrap:anywhere] text-slate-900 ${
        large
          ? compact
            ? 'text-lg leading-6'
            : 'text-2xl leading-8'
          : compact
            ? 'text-sm leading-[1.35rem]'
            : 'text-[15px] leading-5'
      } ${clamp ? (compact ? 'line-clamp-3' : 'line-clamp-5') : ''}`}
    >
      {text ? richText(text) : <span className="text-slate-500">{emptyText}</span>}
    </p>
  );
  const more = cut && seeMore && <span className="mt-0.5 block text-sm font-semibold text-slate-600">{seeMore}</span>;

  return (
    <Tag className={`card overflow-hidden ${className}`}>
      <header className={`flex items-start gap-2.5 ${compact ? 'px-3 pt-3' : 'px-4 pt-3'}`}>
        <FeedAvatar name={author.name} pictureUrl={author.pictureUrl} size={compact ? 'sm' : 'md'} />
        <div className="min-w-0 flex-1">
          <p className={`truncate font-semibold text-slate-900 ${compact ? 'text-sm' : 'text-[15px]'}`}>
            {author.name}
          </p>
          <p className="flex items-center gap-1 text-[13px] leading-4 text-slate-600">
            <span className="min-w-0 truncate">{meta}</span>
            <Icon name="globe" size={12} className="shrink-0 text-slate-500" />
          </p>
        </div>
        {badge && <div className="shrink-0">{badge}</div>}
      </header>

      <div className={compact ? 'px-3 py-2' : 'px-4 py-3'}>
        {href ? (
          <Link href={href} className="block hover:opacity-80">
            {body}
            {more}
          </Link>
        ) : (
          <>
            {body}
            {more}
          </>
        )}
      </div>

      {attachments.length > 0 && <MediaGrid media={attachments} compact={compact} href={mediaHref} />}

      {/* Facebook shows the link card only when nothing else is attached:
          a photo post with a link in it is a photo post. */}
      {preview && attachments.length === 0 && <LinkCard preview={preview} compact={compact} />}

      {stats && (
        <div
          className={`flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-slate-600 ${
            compact ? 'px-3 py-2 text-[13px]' : 'px-4 py-2 text-[15px]'
          }`}
        >
          <span className="flex items-center gap-1.5">
            <span
              aria-hidden
              className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-brand-500 text-white"
            >
              <Icon name="thumbsUp" size={11} />
            </span>
            <span className="nums">{stats.reactions.toLocaleString()}</span>
          </span>
          <span className="flex flex-wrap gap-x-3">
            {stats.others.map((item) => (
              <span key={item} className="nums">
                {item}
              </span>
            ))}
          </span>
        </div>
      )}

      {comment && comment.text.trim() && (
        <div className={`flex items-start gap-2 border-t border-slate-200 ${compact ? 'px-3 py-2' : 'px-4 py-2.5'}`}>
          <FeedAvatar name={author.name} pictureUrl={author.pictureUrl} size="xs" />
          <div className="min-w-0">
            <div className="rounded-2xl bg-slate-100 px-3 py-1.5">
              <p className="truncate text-[13px] font-semibold text-slate-900">{author.name}</p>
              <p className="whitespace-pre-wrap [overflow-wrap:anywhere] text-sm text-slate-900">
                {richText(comment.text)}
              </p>
            </div>
            {comment.note && <p className="mt-0.5 px-3 text-xs text-slate-500">{comment.note}</p>}
          </div>
        </div>
      )}

      {footer && (
        <div className={`border-t border-slate-200 ${compact ? 'px-2 py-1' : 'mx-4 py-1'}`}>{footer}</div>
      )}
    </Tag>
  );
}

/**
 * Facebook's layouts for what a post carries. One photo fills the width at
 * its own shape; one video plays in place; two sit side by side; three or
 * more are one large and a row under it, the last tile carrying "+N" for the
 * ones that do not fit. A video among photos is a tile with a play button.
 */
export function MediaGrid({
  media,
  compact = false,
  href,
}: {
  media: FeedMedia[];
  compact?: boolean;
  /** Where a video with only a poster plays. */
  href?: string | null;
}) {
  const shown = media.slice(0, 4);
  const extra = media.length - shown.length;

  if (shown.length === 1) {
    const [only] = shown as [FeedMedia];
    if (only.kind === 'video') return <SingleVideo video={only} compact={compact} href={href} />;
    return (
      // A floor while it loads, so the card does not jump when it arrives.
      <div className={`bg-slate-100 ${compact ? 'min-h-32' : 'min-h-48'}`}>
        {/* eslint-disable-next-line @next/next/no-img-element -- uploads and Facebook's CDN alike; next/image would need every host allow-listed */}
        <img
          src={only.url ?? ''}
          alt={only.alt ?? ''}
          loading="lazy"
          className={`mx-auto block w-full object-contain ${compact ? 'max-h-72' : 'max-h-[36rem]'}`}
        />
      </div>
    );
  }

  const tile = (item: FeedMedia, index: number, cls: string) => (
    <div key={index} className={`relative overflow-hidden bg-slate-100 ${cls}`}>
      <Still item={item} />
      {item.kind === 'video' && <PlayBadge small={compact || shown.length > 2} />}
      {extra > 0 && index === shown.length - 1 && (
        <span className="absolute inset-0 flex items-center justify-center bg-black/50 text-2xl font-bold text-white">
          +{extra}
        </span>
      )}
    </div>
  );

  if (shown.length === 2) {
    return (
      <div className={`grid grid-cols-2 gap-0.5 ${compact ? 'h-44' : 'h-80'}`}>
        {shown.map((item, index) => tile(item, index, 'h-full'))}
      </div>
    );
  }

  const [lead, ...rest] = shown as [FeedMedia, ...FeedMedia[]];
  return (
    <div className="grid gap-0.5">
      {tile(lead, 0, compact ? 'h-44' : 'h-80')}
      <div className={`grid gap-0.5 ${rest.length === 2 ? 'grid-cols-2' : 'grid-cols-3'} ${compact ? 'h-24' : 'h-40'}`}>
        {rest.map((item, index) => tile(item, index + 1, 'h-full'))}
      </div>
    </div>
  );
}

/** A photo, or a video's first frame or poster, filling its tile. */
function Still({ item }: { item: FeedMedia }) {
  if (item.kind === 'video' && !item.poster && item.url) {
    // The first frame stands in for a poster on a file uploaded here.
    return <video src={`${item.url}#t=0.1`} muted playsInline preload="metadata" className="h-full w-full object-cover" />;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={(item.kind === 'video' ? item.poster : item.url) ?? ''}
      alt={item.alt ?? ''}
      loading="lazy"
      className="h-full w-full object-cover"
    />
  );
}

/** One video, played in the feed the way Facebook plays it: on black. */
function SingleVideo({ video, compact, href }: { video: FeedMedia; compact: boolean; href?: string | null }) {
  const box = `relative flex items-center justify-center bg-black ${compact ? 'max-h-72' : 'max-h-[36rem]'}`;
  if (video.url) {
    return (
      <div className={box}>
        <video
          // Without a poster, the first frame rather than a black box.
          src={video.poster ? video.url : `${video.url}#t=0.1`}
          poster={video.poster ?? undefined}
          controls
          playsInline
          preload="metadata"
          className={`w-full ${compact ? 'max-h-72' : 'max-h-[36rem]'}`}
        />
      </div>
    );
  }
  // Facebook keeps the file: show its still, and play it there.
  const still = (
    <div className={`${box} aspect-video`}>
      {video.poster && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={video.poster} alt={video.alt ?? ''} loading="lazy" className="h-full w-full object-contain" />
      )}
      <PlayBadge />
    </div>
  );
  return href ? (
    <ExternalLink href={href} className="block">
      {still}
    </ExternalLink>
  ) : (
    still
  );
}

function PlayBadge({ small = false }: { small?: boolean }) {
  return (
    <span aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <span
        className={`flex items-center justify-center rounded-full border-2 border-white bg-black/50 text-white ${
          small ? 'h-10 w-10' : 'h-16 w-16'
        }`}
      >
        <svg viewBox="0 0 24 24" className={small ? 'ml-0.5 h-5 w-5' : 'ml-1 h-8 w-8'} fill="currentColor">
          <path d="M8 5v14l11-7z" />
        </svg>
      </span>
    </span>
  );
}

/**
 * The link card as the feed draws it: the page's image at Facebook's 1.91:1,
 * and under it, on grey, the site in capitals, the title, and a line of the
 * description. Without a scraped preview, the address alone.
 */
export function LinkCard({ preview, compact = false }: { preview: FeedLinkPreview; compact?: boolean }) {
  return (
    <ExternalLink href={preview.url} className="block border-y border-slate-200 bg-slate-100 hover:bg-slate-200/70">
      {preview.imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={preview.imageUrl} alt="" loading="lazy" className="aspect-[1.91/1] w-full object-cover" />
      )}
      <span className={`block ${compact ? 'px-3 py-2' : 'px-4 py-2.5'}`}>
        <span className="block truncate text-[12px] uppercase tracking-wide text-slate-600">
          {preview.siteName || hostOf(preview.url)}
        </span>
        <span
          className={`line-clamp-2 font-semibold text-slate-900 ${compact ? 'text-sm leading-5' : 'text-[17px] leading-[1.35rem]'}`}
        >
          {preview.title || preview.url}
        </span>
        {preview.description && !compact && (
          <span className="mt-0.5 line-clamp-1 text-[15px] text-slate-600">{preview.description}</span>
        )}
      </span>
    </ExternalLink>
  );
}

/** Hashtags and addresses in Facebook's link blue, as they will be on the Page. */
export function richText(text: string): ReactNode[] {
  return text.split(/(#[\p{L}\p{N}_]+|https?:\/\/[^\s]+)/u).map((part, index) =>
    (part.startsWith('#') && part.length > 1) || /^https?:\/\//.test(part) ? (
      <span key={index} className="font-semibold text-brand-600 [overflow-wrap:anywhere]">
        {part}
      </span>
    ) : (
      part
    ),
  );
}

export function FeedAvatar({
  name,
  pictureUrl,
  size = 'md',
}: {
  name: string;
  pictureUrl: string | null;
  size?: 'xs' | 'sm' | 'md';
}) {
  const box =
    size === 'xs' ? 'h-6 w-6 text-[11px]' : size === 'sm' ? 'h-8 w-8 text-xs' : 'h-10 w-10 text-[15px]';
  return pictureUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={pictureUrl} alt="" className={`${box} shrink-0 rounded-full object-cover`} />
  ) : (
    <span
      aria-hidden
      className={`${box} flex shrink-0 items-center justify-center rounded-full bg-brand-50 font-bold text-brand-600`}
    >
      {name.charAt(0).toUpperCase() || '?'}
    </span>
  );
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}
