import type { ReactNode } from 'react';

import { FeedAvatar, FeedPost, type FeedLinkPreview, type FeedMedia } from './FeedPost';

export interface PreviewPost {
  id: string;
  message: string;
  meta: string;
  badge?: ReactNode;
  href?: string;
  media: FeedMedia[];
  link: string | null;
  linkPreview: FeedLinkPreview | null;
}

/**
 * A Page's timeline as it will read once what is planned has gone out: the
 * Page's header, then the coming posts newest-last in the order followers
 * will meet them, then what is already there. The question it answers is
 * the one a calendar cannot: does the next fortnight look like a feed
 * somebody would want to follow, or three link posts in a row?
 */
export function PageFeedPreview({
  page,
  upcoming,
  recent,
  labels,
}: {
  page: { name: string; pictureUrl: string | null; category: string | null; followers: number | null };
  upcoming: PreviewPost[];
  recent: PreviewPost[];
  labels: {
    followers: string | null;
    upcoming: string;
    upcomingEmpty: string;
    recent: string;
    noText: string;
    seeMore: string;
  };
}) {
  const card = (post: PreviewPost) => (
    <li key={post.id}>
      <FeedPost
        clamp
        author={{ name: page.name, pictureUrl: page.pictureUrl }}
        meta={post.meta}
        badge={post.badge}
        href={post.href}
        message={post.message}
        emptyText={labels.noText}
        media={post.media}
        link={post.link}
        linkPreview={post.linkPreview}
        seeMore={labels.seeMore}
      />
    </li>
  );

  return (
    <div className="mx-auto max-w-[680px] space-y-4">
      <section className="card overflow-hidden">
        <div className="h-28 bg-gradient-to-br from-brand-500 via-brand-400 to-sky-300 sm:h-36" aria-hidden />
        <div className="flex items-end gap-4 px-4 pb-4">
          <span className="-mt-10 rounded-full ring-4 ring-white">
            {page.pictureUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={page.pictureUrl} alt="" className="h-24 w-24 rounded-full object-cover" />
            ) : (
              <span className="flex h-24 w-24 items-center justify-center rounded-full bg-brand-50 text-3xl font-bold text-brand-600">
                {page.name.charAt(0).toUpperCase()}
              </span>
            )}
          </span>
          <div className="min-w-0 pb-1">
            <h2 className="truncate text-2xl font-bold text-slate-900">{page.name}</h2>
            <p className="truncate text-sm text-slate-600">
              {[labels.followers, page.category].filter(Boolean).join(' · ')}
            </p>
          </div>
        </div>
      </section>

      <h3 className="px-1 text-[17px] font-bold text-slate-900">{labels.upcoming}</h3>
      {upcoming.length === 0 ? (
        <div className="card flex items-center gap-3 p-4 text-sm text-slate-600">
          <FeedAvatar name={page.name} pictureUrl={page.pictureUrl} size="sm" />
          {labels.upcomingEmpty}
        </div>
      ) : (
        <ol className="space-y-3">{upcoming.map(card)}</ol>
      )}

      {recent.length > 0 && (
        <>
          <h3 className="px-1 pt-2 text-[17px] font-bold text-slate-900">{labels.recent}</h3>
          <ol className="space-y-3 opacity-90">{recent.map(card)}</ol>
        </>
      )}
    </div>
  );
}
