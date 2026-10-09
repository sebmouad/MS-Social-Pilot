'use client';

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

  // The download is the report on screen: built from the range that was
  // applied, never from a picker still being changed.
  const applied = new URLSearchParams({ from, to, format: 'csv' }).toString();

  return (
    <div className="flex flex-wrap items-center gap-2 print:hidden">
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
