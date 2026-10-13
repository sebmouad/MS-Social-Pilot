'use client';

import { useTranslations } from 'next-intl';

import { Icon } from './Icon';

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
  pdfName,
  targetIds,
}: {
  /** What the saved PDF is called: the browser names it after the tab. */
  pdfName?: string;
  /** Resolved channel scope of the report on screen. */
  targetIds: string[];
  /** The range the report on screen covers, as calendar days. */
  from: string;
  to: string;
  /** False while the requested range was refused: there is no report to save. */
  downloadable?: boolean;
}) {
  const t = useTranslations('reports');

  // The download is the report on screen: built from the range that was
  // applied, never from a picker still being changed.
  const applied = new URLSearchParams({ from, to, format: 'csv', pages: targetIds.join(',') }).toString();

  return (
    <div className="flex flex-wrap items-center gap-2 print:hidden">
      {downloadable && (
        <a className="btn-secondary" href={`/api/reports?${applied}`}>
          {t('downloadCsv')}
        </a>
      )}
      <button
        type="button"
        className="btn-secondary"
        onClick={() => {
          const previous = document.title;
          if (pdfName) document.title = pdfName;
          window.print();
          document.title = previous;
        }}
      >
        <Icon name="download" size={16} />
        {t('downloadPdf')}
      </button>
    </div>
  );
}
