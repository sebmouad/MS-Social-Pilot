'use client';

import { useLocale, useTranslations } from 'next-intl';

import { Icon } from './Icon';
import type { LinkPreview, PostMedia } from '@/lib/json';

interface Props {
  /** The first destination ticked, or null before any is. */
  page: { name: string; pictureUrl: string | null } | null;
  message: string;
  media: PostMedia[];
  link: LinkPreview | null;
  timing: 'now' | 'schedule' | 'queue';
  /** `datetime-local` wall time in the workspace's zone. */
  scheduledAt: string;
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
export function PostPreview({ page, message, media, link, timing, scheduledAt }: Props) {
  const t = useTranslations('compose');
  const locale = useLocale();

  const when =
    timing === 'now'
      ? t('previewNow')
      : timing === 'queue'
        ? t('previewQueued')
        : formatWallTime(scheduledAt, locale);

  const name = page?.name ?? t('previewPage');
  const images = media.filter((item) => item.kind === 'image');
  const video = media.find((item) => item.kind === 'video');
  const empty = !message.trim() && media.length === 0 && !link;

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
              <p className="whitespace-pre-wrap px-4 pb-3 pt-2 text-[15px] leading-5 text-slate-900">
                {withHashtags(message)}
              </p>
            )}

            {images.length > 0 && <ImageGrid images={images} />}

            {!images.length && video && (
              <div className="flex aspect-video items-center justify-center bg-slate-900 text-white">
                <Icon name="video" size={36} />
                <span className="sr-only">{t('video')}</span>
              </div>
            )}

            {!media.length && link && (
              <div className="border-y border-slate-200 bg-slate-100">
                {link.imageUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={link.imageUrl} alt="" className="aspect-[1.91/1] w-full object-cover" />
                )}
                <div className="px-3 py-2.5">
                  <p className="truncate text-[13px] text-slate-600">{link.siteName ?? hostOf(link.url)}</p>
                  {link.title && (
                    <p className="line-clamp-2 text-[15px] font-semibold leading-5 text-slate-900">{link.title}</p>
                  )}
                </div>
              </div>
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
      </div>
    </section>
  );
}

/** Up to four photos in Facebook's grid: one full, two side by side, then a tile row. */
function ImageGrid({ images }: { images: PostMedia[] }) {
  const shown = images.slice(0, 4);
  const extra = images.length - shown.length;

  if (shown.length === 1) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={shown[0]!.url} alt={shown[0]!.altText ?? ''} className="max-h-[28rem] w-full object-cover" />;
  }

  return (
    <div className="grid grid-cols-2 gap-0.5">
      {shown.map((image, index) => (
        <div
          key={image.id}
          className={`relative aspect-square ${shown.length === 3 && index === 0 ? 'col-span-2 aspect-[2/1]' : ''}`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={image.url} alt={image.altText ?? ''} className="h-full w-full object-cover" />
          {extra > 0 && index === shown.length - 1 && (
            <span className="absolute inset-0 flex items-center justify-center bg-black/40 text-3xl font-semibold text-white">
              +{extra}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

/** Hashtags in Facebook's link blue, as they will be on the Page. */
function withHashtags(text: string) {
  return text.split(/(#[\p{L}\p{N}_]+)/u).map((part, index) =>
    part.startsWith('#') && part.length > 1 ? (
      <span key={index} className="font-semibold text-brand-600">
        {part}
      </span>
    ) : (
      part
    ),
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

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}
