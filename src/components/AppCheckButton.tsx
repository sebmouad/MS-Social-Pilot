'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

import { Icon } from './Icon';

type Result = { valid: boolean; headline: string };

/** Root's test of the Facebook app ID and secret: one call, on request, never on page load. */
export function AppCheckButton() {
  const t = useTranslations('root.worker');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | 'failed' | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        className="btn-secondary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setResult(null);
          try {
            const response = await fetch('/api/root/app-check', { method: 'POST' });
            setResult(response.ok ? ((await response.json()) as Result) : 'failed');
          } catch {
            setResult('failed');
          } finally {
            setBusy(false);
          }
        }}
      >
        <Icon name="facebook" size={14} /> {busy ? t('appChecking') : t('appCheck')}
      </button>
      <p role="status" className={`text-sm ${result && result !== 'failed' && result.valid ? 'text-emerald-700' : result ? 'text-red-700' : 'text-slate-600'}`}>
        {result === 'failed' ? t('appCheckFailed') : result ? result.headline : t('appCheckHint')}
      </p>
    </div>
  );
}
