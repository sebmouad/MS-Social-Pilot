'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useTranslations } from 'next-intl';

/**
 * Date range picker, CSV download and print.
 *
 * "Print or save as PDF" opens the browser's print dialogue against a
 * print-styled page, rather than generating a PDF server-side. That keeps
 * headless Chromium out of the production image for the sake of one feature.
 */
export function ReportControls({ from, to }: { from: string; to: string }) {
  const t = useTranslations('reports');
  const router = useRouter();

  const [start, setStart] = useState(from);
  const [end, setEnd] = useState(to);

  const query = `from=${start}&to=${end}`;

  return (
    <div className="flex flex-wrap items-end gap-2 print:hidden">
      <div>
        <label className="label text-xs" htmlFor="reportFrom">
          {t('from')}
        </label>
        <input
          id="reportFrom"
          type="date"
          className="input"
          value={start}
          max={end}
          onChange={(event) => setStart(event.target.value)}
        />
      </div>
      <div>
        <label className="label text-xs" htmlFor="reportTo">
          {t('to')}
        </label>
        <input
          id="reportTo"
          type="date"
          className="input"
          value={end}
          min={start}
          onChange={(event) => setEnd(event.target.value)}
        />
      </div>

      <button type="button" className="btn-primary" onClick={() => router.push(`/reports?${query}`)}>
        {t('generate')}
      </button>
      <a className="btn-secondary" href={`/api/reports?${query}&format=csv`}>
        {t('downloadCsv')}
      </a>
      <button type="button" className="btn-secondary" onClick={() => window.print()}>
        {t('print')}
      </button>
    </div>
  );
}
