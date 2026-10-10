import Link from 'next/link';
import type { ReactNode } from 'react';

import { ExternalLink } from './ExternalLink';
import { Icon } from './Icon';

/**
 * A post as Facebook draws it in the feed: the Page's photo and name, when it
 * went out, the text, the pictures under it, a link card, then the counts.
 *
 * One component for every screen that shows a post — the dashboard, the
 * review queue, the analytics and the report — so a post reads the same
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
  href,
  images = [],
  link,
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
  /** Where the text leads: the post's own report, the composer. */
  href?: string;
  images?: Array<{ url: string; alt?: string | null }>;
  link?: string | null;
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
  const body = (
    <p
      className={`whitespace-pre-wrap [overflow-wrap:anywhere] text-slate-900 ${
        compact ? 'text-sm leading-[1.35rem]' : 'text-[15px] leading-5'
      } ${clamp ? (compact ? 'line-clamp-3' : 'line-clamp-5') : ''}`}
    >
      {text || <span className="text-slate-500">{emptyText}</span>}
    </p>
  );

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
          </Link>
        ) : (
          body
        )}
      </div>

      {images.length > 0 && <MediaGrid images={images} compact={compact} />}

      {link && (
        <ExternalLink
          href={link}
          className={`block border-y border-slate-200 bg-slate-100 hover:bg-slate-200 ${
            compact ? 'px-3 py-2' : 'px-4 py-2.5'
          } ${images.length > 0 ? 'border-t-0' : ''}`}
        >
          <span className="block truncate text-[12px] uppercase text-slate-600">{hostOf(link)}</span>
          <span className={`block truncate font-semibold text-slate-900 ${compact ? 'text-sm' : 'text-[15px]'}`}>
            {link}
          </span>
        </ExternalLink>
      )}

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
              <p className="whitespace-pre-wrap [overflow-wrap:anywhere] text-sm text-slate-900">{comment.text}</p>
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
 * Facebook's photo layouts: one picture fills the width, two sit side by
 * side, and three or more are one large and a row under it, the last
 * carrying "+N" for the ones that do not fit.
 */
export function MediaGrid({
  images,
  compact = false,
}: {
  images: Array<{ url: string; alt?: string | null }>;
  compact?: boolean;
}) {
  const shown = images.slice(0, 4);
  const extra = images.length - shown.length;
  const img = (image: { url: string; alt?: string | null }, cls: string) => (
    // eslint-disable-next-line @next/next/no-img-element -- uploads and Facebook's CDN alike; next/image would need every host allow-listed
    <img src={image.url} alt={image.alt ?? ''} loading="lazy" className={`h-full w-full bg-slate-100 object-cover ${cls}`} />
  );

  if (shown.length === 1) {
    return (
      <div className={compact ? 'max-h-60 overflow-hidden' : 'max-h-[32rem] overflow-hidden'}>
        {img(shown[0]!, compact ? 'max-h-60' : 'max-h-[32rem]')}
      </div>
    );
  }
  if (shown.length === 2) {
    return (
      <div className={`grid grid-cols-2 gap-0.5 ${compact ? 'h-40' : 'h-72'}`}>
        {shown.map((image, index) => (
          <div key={index} className="overflow-hidden">
            {img(image, '')}
          </div>
        ))}
      </div>
    );
  }
  const [lead, ...rest] = shown;
  return (
    <div className="grid gap-0.5">
      <div className={`overflow-hidden ${compact ? 'h-40' : 'h-72'}`}>{img(lead!, '')}</div>
      <div className={`grid gap-0.5 ${rest.length === 2 ? 'grid-cols-2' : 'grid-cols-3'} ${compact ? 'h-20' : 'h-36'}`}>
        {rest.map((image, index) => (
          <div key={index} className="relative overflow-hidden">
            {img(image, '')}
            {extra > 0 && index === rest.length - 1 && (
              <span className="absolute inset-0 flex items-center justify-center bg-black/50 text-2xl font-bold text-white">
                +{extra}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
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
