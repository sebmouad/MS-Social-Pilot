'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

/**
 * Destination selector for the analytics screen.
 *
 * A navigation rather than client state: the page is server-rendered per
 * destination, so changing it must re-run the query.
 */
export function PagePicker({
  pages,
  selectedId,
  rangeQuery,
  view = 'overview',
}: {
  pages: Array<{ id: string; name: string }>;
  selectedId: string;
  /** `range=30d` or `from=…&to=…`: switching Page keeps the period. */
  rangeQuery: string;
  /** Kept so switching destination does not also throw away the current tab. */
  view?: string;
}) {
  const t = useTranslations('analytics');
  const router = useRouter();

  if (pages.length < 2) return null;

  return (
    <label>
      <span className="sr-only">{t('choosePage')}</span>
      <select
        className="h-10 w-auto max-w-[14rem] cursor-pointer rounded-md border-0 bg-slate-200 py-0 pl-3.5 pr-8 text-[15px] font-semibold text-slate-900 hover:bg-slate-300 focus:ring-2 focus:ring-brand-500"
        value={selectedId}
        onChange={(event) =>
          router.push(`/analytics?view=${view}&target=${event.target.value}&${rangeQuery}`)
        }
      >
        {pages.map((page) => (
          <option key={page.id} value={page.id}>
            {page.name}
          </option>
        ))}
      </select>
    </label>
  );
}
