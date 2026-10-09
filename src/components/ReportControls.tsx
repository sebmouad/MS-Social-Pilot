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
export function ReportControls({
  from,
  to,
  downloadable = true,
}: {
  /** The range the report on screen covers, as calendar days. */
  from: string;
  to: string;
  /** False while the requested range was refused: there is no report to save. */
  downloadable?: boolean;
}) {
  const t = useTranslations('reports');
  const router = useRouter();

  const [start, setStart] = useState(from);
  const [end, setEnd] = useState(to);

  const pending = new URLSearchParams({ from: start, to: end }).toString();
  // The download is the report on screen, so it is built from the range that
  // was applied rather than from the fields. Built from the fields, changing a
  // date and downloading without pressing Generate saved a file for a period
  // nobody had looked at, under a name that suggested otherwise.
  const applied = new URLSearchParams({ from, to, format: 'csv' }).toString();

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

      <button type="button" className="btn-primary" onClick={() => router.push(`/reports?${pending}`)}>
        {t('generate')}
      </button>
      {downloadable && (
        <a className="btn-secondary" href={`/api/reports?${applied}`}>
          {t('downloadCsv')}
        </a>
      )}
      <button type="button" className="btn-secondary" onClick={() => window.print()}>
        {t('print')}
      </button>
    </div>
  );
}
