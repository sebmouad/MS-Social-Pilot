'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { TargetPicker, type TargetOption } from './TargetPicker';

export function BulkUpload({
  targets,
  timezone,
  csvTemplate,
}: {
  targets: TargetOption[];
  timezone: string;
  csvTemplate: string;
}) {
  const t = useTranslations('settings');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const [csv, setCsv] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [summary, setSummary] = useState<{
    total: number;
    scheduled: number;
    failed: number;
    results: Array<{ row: number; status: string; message?: string }>;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function upload() {
    setPending(true);
    setError(null);
    setSummary(null);

    try {
      const response = await fetch('/api/posts/bulk', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ csv, targetIds: selected, timezone, publishMode: 'worker' }),
      });
      const body = (await response.json().catch(() => ({}))) as Record<string, unknown> & { error?: string };

      if (!response.ok) {
        setError(body.error ?? t('uploadFailed'));
      } else {
        setSummary(body as never);
        router.refresh();
      }
    } catch {
      // Some rows may have been scheduled before the connection dropped; the
      // posts list is where to check, and the message does not claim otherwise.
      setError(t('networkError'));
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="card p-5">
      <h2 className="text-sm font-semibold text-slate-900">{t('bulk')}</h2>
      <p className="mt-1 text-sm text-slate-600">{t('bulkColumns', { timezone })}</p>

      <details className="mt-3">
        <summary className="cursor-pointer text-xs font-medium text-brand-600">{t('showExample')}</summary>
        <pre className="mt-2 overflow-x-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-100">
          {csvTemplate}
        </pre>
      </details>

      <div className="mt-4">
        <label className="label" htmlFor="csvFile">
          {t('uploadCsvFile')}
        </label>
        <input
          id="csvFile"
          type="file"
          accept=".csv,text/csv"
          className="mb-2 block w-full text-sm text-slate-600 file:me-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium hover:file:bg-slate-200"
          onChange={async (event) => {
            const file = event.target.files?.[0];
            if (file) setCsv(await file.text());
          }}
        />
        <label className="label" htmlFor="csvInput">
          {t('pasteOrUpload')}
        </label>
        <textarea
          id="csvInput"
          className="input min-h-[120px] font-mono text-xs"
          value={csv}
          onChange={(event) => setCsv(event.target.value)}
          placeholder="message,link,scheduled_at,media_url"
        />
      </div>

      <div className="mt-4">
        <span className="label">{t('bulkDestinations')}</span>
        <TargetPicker targets={targets} selected={selected} onChange={setSelected} />
      </div>

      {error && (
        <div role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {summary && (
        <div className="mt-4 rounded-lg border border-slate-200 p-3 text-sm">
          <p className="font-medium text-slate-900">
            {t('rowsScheduled', { scheduled: summary.scheduled, total: summary.total })}
            {summary.failed > 0 ? t('rowsFailed', { count: summary.failed }) : ''}
          </p>
          {summary.failed > 0 && (
            <ul className="mt-2 space-y-0.5 text-xs text-red-600">
              {summary.results
                .filter((result) => result.status === 'error')
                .map((result) => (
                  <li key={result.row}>
                    {t('row')} {result.row}: {result.message}
                  </li>
                ))}
            </ul>
          )}
        </div>
      )}

      <button
        type="button"
        className="btn-primary mt-4"
        disabled={pending || !csv.trim() || selected.length === 0}
        onClick={upload}
      >
        {pending ? t('scheduling') : t('scheduleAllRows')}
      </button>
    </section>
  );
}
