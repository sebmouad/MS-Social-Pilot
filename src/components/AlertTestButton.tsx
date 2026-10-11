'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

import { Icon } from './Icon';

/** Sends one test alert, so root knows the email and Telegram chat work before something breaks. */
export function AlertTestButton() {
  const t = useTranslations('root.alerts');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle');
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        className="btn-secondary"
        disabled={state === 'sending'}
        onClick={async () => {
          setState('sending');
          try {
            const response = await fetch('/api/root/alerts/test', { method: 'POST' });
            setState(response.ok ? 'sent' : 'failed');
          } catch {
            setState('failed');
          }
        }}
      >
        <Icon name="bell" size={14} /> {state === 'sending' ? t('sending') : t('test')}
      </button>
      <p role="status" className="text-sm text-slate-600">
        {state === 'sent' ? t('testSent') : state === 'failed' ? t('testFailed') : t('testHint')}
      </p>
    </div>
  );
}
