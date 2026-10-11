import Link from 'next/link';

import { FeedAvatar } from './FeedPost';
import { LabelChips } from './LabelChips';

export interface BoardCard {
  id: string;
  message: string;
  pages: Array<{ name: string; pictureUrl: string | null }>;
  when: string | null;
  imageUrl: string | null;
  href: string;
  labels: Array<{ id: string; name: string; color: string }>;
  /** What clients said through a review link, newest first. */
  feedback?: { approved: number; rejected: number; comments: number };
}

export interface BoardColumn {
  key: string;
  title: string;
  hint: string;
  tone: string;
  cards: BoardCard[];
  empty: string;
}

/**
 * The approval workflow as a board: what is being written, what waits for a
 * reviewer, what is cleared to go, and what was sent back. One glance shows
 * where the week's content is stuck.
 */
export function ApprovalBoard({ columns, noText }: { columns: BoardColumn[]; noText: string }) {
  return (
    <div className="scroll-x -mx-4 px-4 sm:mx-0 sm:px-0">
      <div className="grid min-w-[60rem] grid-cols-4 items-start gap-4">
        {columns.map((column) => (
          <section key={column.key} aria-labelledby={`board-${column.key}`} className="rounded-xl bg-slate-200/60 p-2">
            <header className="flex items-center gap-2 px-2 pb-2 pt-1">
              <span aria-hidden className={`h-2.5 w-2.5 rounded-full ${column.tone}`} />
              <h2 id={`board-${column.key}`} className="flex-1 text-sm font-bold text-slate-900">
                {column.title}
              </h2>
              <span className="nums rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-slate-700">
                {column.cards.length}
              </span>
            </header>
            <p className="px-2 pb-2 text-[11px] text-slate-600">{column.hint}</p>
            {column.cards.length === 0 ? (
              <p className="rounded-lg border-2 border-dashed border-slate-300 px-3 py-6 text-center text-xs text-slate-500">
                {column.empty}
              </p>
            ) : (
              <ol className="space-y-2">
                {column.cards.map((card) => (
                  <li key={card.id}>
                    <Link href={card.href} className="block rounded-lg bg-white p-3 shadow-surface transition-shadow hover:shadow-md">
                      <span className="flex items-center gap-2">
                        <FeedAvatar name={card.pages[0]?.name ?? '?'} pictureUrl={card.pages[0]?.pictureUrl ?? null} size="xs" />
                        <span className="min-w-0 flex-1 truncate text-xs font-semibold text-slate-900">
                          {card.pages.map((page) => page.name).join(', ')}
                        </span>
                      </span>
                      {card.when && <span className="mt-1 block text-[11px] text-slate-500">{card.when}</span>}
                      <span className="mt-1.5 flex gap-2">
                        <span className="line-clamp-3 min-w-0 flex-1 text-[13px] leading-snug text-slate-800 [overflow-wrap:anywhere]">
                          {card.message || noText}
                        </span>
                        {card.imageUrl && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={card.imageUrl} alt="" loading="lazy" className="h-12 w-12 shrink-0 rounded-md object-cover" />
                        )}
                      </span>
                      {card.labels.length > 0 && (
                        <span className="mt-2 block">
                          <LabelChips labels={card.labels} size="xs" />
                        </span>
                      )}
                      {card.feedback && card.feedback.approved + card.feedback.rejected + card.feedback.comments > 0 && (
                        <span className="nums mt-2 flex gap-2 text-[11px] font-semibold">
                          {card.feedback.approved > 0 && <span className="text-emerald-700">✓ {card.feedback.approved}</span>}
                          {card.feedback.rejected > 0 && <span className="text-rose-700">✕ {card.feedback.rejected}</span>}
                          {card.feedback.comments > 0 && <span className="text-slate-600">💬 {card.feedback.comments}</span>}
                        </span>
                      )}
                    </Link>
                  </li>
                ))}
              </ol>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
