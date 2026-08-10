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
  days,
}: {
  pages: Array<{ id: string; name: string }>;
  selectedId: string;
  days: number;
}) {
  const t = useTranslations('analytics');
  const router = useRouter();

  if (pages.length < 2) return null;

  return (
    <label>
      <span className="sr-only">{t('choosePage')}</span>
      <select
        className="input"
        value={selectedId}
        onChange={(event) => router.push(`/analytics?target=${event.target.value}&days=${days}`)}
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
