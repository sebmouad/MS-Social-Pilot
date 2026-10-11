'use client';

import { useLocale, useTranslations } from 'next-intl';

import { Icon } from './Icon';
import { LARGE_TEXT_MAX, LinkCard, MediaGrid, richText } from './FeedPost';
import type { LinkPreview, PostMedia } from '@/lib/json';

interface Props {
  /** The first destination ticked, or null before any is. */
  page: { name: string; pictureUrl: string | null } | null;
  message: string;
  media: PostMedia[];
  link: LinkPreview | null;
  /** Posted as the Page under the post; drawn as Facebook shows a comment. */
  firstComment?: string;
  timing: 'now' | 'schedule' | 'queue';
  /** `datetime-local` wall time in the workspace's zone. */
  scheduledAt: string;
  /** A Reel or a Story is drawn full-screen and upright, as the phone shows it. */
  format?: 'post' | 'reel' | 'story';
}

/**
 * The post as it will look on the Page, drawn the way Facebook draws it.
 *
 * Writing for a Page means writing for a feed: where the lines break, how
 * much of a long caption shows, whether the photo or the link card leads. A
 * textarea answers none of that, so the composer shows the post itself, in
 * Facebook's layout, while it is being written. It is a likeness, not a
 * rendering by Facebook: its actions are drawn, not live.
 */
export function PostPreview({ page, message, media, link, firstComment, timing, scheduledAt, format = 'post' }: Props) {
  const t = useTranslations('compose');
  const locale = useLocale();

  if (format !== 'post') {
    const item = media[0];
    return (
      <section aria-labelledby="post-preview-title">
        <h2 id="post-preview-title" className="mb-2 text-sm font-semibold text-slate-600">
          {t('previewTitle')}
        </h2>
        <div className="mx-auto w-[260px] overflow-hidden rounded-[28px] bg-black p-2 shadow-xl ring-1 ring-black/10">
          <div className="relative aspect-[9/16] overflow-hidden rounded-[22px] bg-slate-900">
            {item ? (
              item.kind === 'video' ? (
                <video src={`${item.url}#t=0.1`} muted playsInline preload="metadata" className="h-full w-full object-cover" />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={item.url} alt={item.altText ?? ''} className="h-full w-full object-cover" />
              )
            ) : (
              <span className="flex h-full items-center justify-center px-6 text-center text-sm text-white/70">
                {format === 'reel' ? t('reelNeedsVideo') : t('storyNeedsMedia')}
              </span>
            )}
            <div className="absolute inset-x-0 top-0 flex items-center gap-2 bg-gradient-to-b from-black/60 to-transparent p-3">
              {format === 'story' && <span className="absolute inset-x-3 top-2 h-0.5 rounded bg-white/80" />}
              {page?.pictureUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={page.pictureUrl} alt="" className="mt-1 h-8 w-8 rounded-full object-cover ring-2 ring-white" />
              ) : (
                <span className="mt-1 flex h-8 w-8 items-center justify-center rounded-full bg-white/90 text-xs font-bold text-slate-800">
                  {(page?.name ?? '?').charAt(0).toUpperCase()}
                </span>
              )}
              <span className="mt-1 truncate text-sm font-semibold text-white">{page?.name ?? t('previewPage')}</span>
            </div>
            {format === 'reel' && message.trim() && (
              <p className="absolute inset-x-0 bottom-0 line-clamp-3 bg-gradient-to-t from-black/70 to-transparent p-3 pt-8 text-[13px] leading-snug text-white">
                {message}
              </p>
            )}
          </div>
        </div>
      </section>
    );
  }

  const when =
    timing === 'now'
      ? t('previewNow')
      : timing === 'queue'
        ? t('previewQueued')
        : formatWallTime(scheduledAt, locale);

  const name = page?.name ?? t('previewPage');
  const empty = !message.trim() && media.length === 0 && !link;
  const large = message.trim().length > 0 && message.trim().length <= LARGE_TEXT_MAX && media.length === 0 && !link;

  return (
    <section aria-labelledby="post-preview-title">
      <h2 id="post-preview-title" className="mb-2 text-sm font-semibold text-slate-600">
        {t('previewTitle')}
      </h2>

      <div className="card overflow-hidden">
        <div className="flex items-center gap-2 px-4 pt-3">
          {page?.pictureUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={page.pictureUrl} alt="" className="h-10 w-10 shrink-0 rounded-full object-cover" />
          ) : (
            <span
              aria-hidden
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-200 text-[15px] font-semibold text-slate-600"
            >
              {name.charAt(0).toUpperCase()}
            </span>
          )}
          <div className="min-w-0">
            <p className="truncate text-[15px] font-semibold text-slate-900">{name}</p>
            <p className="flex items-center gap-1 text-[13px] text-slate-600">
              {when}
              <span aria-hidden>·</span>
              <Icon name="globe" size={12} className="text-slate-500" />
              <span className="sr-only">{t('previewPublic')}</span>
            </p>
          </div>
        </div>

        {empty ? (
          <p className="px-4 py-6 text-[15px] text-slate-500">{t('previewEmpty')}</p>
        ) : (
          <>
            {message.trim() && (
              <p
                className={`whitespace-pre-wrap px-4 pb-3 pt-2 [overflow-wrap:anywhere] text-slate-900 ${
                  large ? 'text-2xl leading-8' : 'text-[15px] leading-5'
                }`}
              >
                {richText(message)}
              </p>
            )}

            {/* The same layouts the rest of the app draws posts in: photo
                grids, a video that plays, Facebook's link card. */}
            {media.length > 0 ? (
              <MediaGrid media={media.map((item) => ({ kind: item.kind, url: item.url, alt: item.altText }))} />
            ) : (
              link && <LinkCard preview={link} />
            )}
          </>
        )}

        {/* Drawn rather than live: these are Facebook's, not this app's. */}
        <div aria-hidden className="mx-4 mt-1 flex border-t border-slate-200 py-1 text-[15px] font-semibold text-slate-600">
          {(['previewLike', 'previewComment', 'previewShare'] as const).map((key) => (
            <span key={key} className="flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5">
              {t(key)}
            </span>
          ))}
        </div>

        {firstComment?.trim() && (
          <div className="flex gap-2 border-t border-slate-200 px-4 py-3">
            {page?.pictureUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={page.pictureUrl} alt="" className="h-8 w-8 shrink-0 rounded-full object-cover" />
            ) : (
              <span
                aria-hidden
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-slate-600"
              >
                {name.charAt(0).toUpperCase()}
              </span>
            )}
            <div className="min-w-0 rounded-2xl bg-slate-100 px-3 py-2">
              <p className="text-[13px] font-semibold text-slate-900">{name}</p>
              <p className="whitespace-pre-wrap [overflow-wrap:anywhere] text-[15px] leading-5 text-slate-900">
                {richText(firstComment)}
              </p>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

/** "2026-10-09T21:24" as the reader writes a date, without moving it between zones. */
function formatWallTime(value: string, locale: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!match) return value;
  const [, year, month, day, hour, minute] = match.map(Number) as number[];
  const wall = new Date(Date.UTC(year!, month! - 1, day!, hour!, minute!));
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  }).format(wall);
}

