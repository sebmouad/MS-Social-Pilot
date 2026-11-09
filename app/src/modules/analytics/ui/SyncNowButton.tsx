'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { IconRefresh } from '@tabler/icons-react';

const COPY = {
  en: { label: 'Sync now', busy: 'Syncing…', done: 'Up to date: latest figures read from your channels.', wait: 'A sync just ran. Try again in a minute.', failed: 'Could not sync. Try again.', help: 'Read the latest figures from Facebook, Instagram and your ad accounts now instead of waiting for the next automatic sync.' },
  fr: { label: 'Synchroniser', busy: 'Synchronisation…', done: 'À jour : derniers chiffres lus sur vos canaux.', wait: 'Une synchronisation vient d’avoir lieu. Réessayez dans une minute.', failed: 'Synchronisation impossible. Réessayez.', help: 'Lire maintenant les derniers chiffres de Facebook, Instagram et de vos comptes publicitaires, sans attendre la prochaine synchronisation automatique.' },
} as const;

/** Insights and Ads: fetch this workspace's figures now (a freshly connected Page otherwise waits for the next sync). */
export function SyncNowButton({ locale = 'en' }: { locale?: 'en' | 'fr' }) {
  const t = COPY[locale];
  const router = useRouter();
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'wait' | 'failed'>('idle');
  async function run() {
    if (state === 'busy') return;
    setState('busy');
    const response = await fetch('/api/analytics/sync', { method: 'POST' }).catch(() => null);
    const next = response?.ok ? 'done' : response?.status === 409 ? 'wait' : 'failed';
    setState(next);
    if (next === 'done') router.refresh();
  }
  return <span className="sync-now">
    <button type="button" className="ui-button ui-button--secondary ui-button--md" onClick={run} disabled={state === 'busy'} aria-busy={state === 'busy'} title={t.help}>
      <IconRefresh size={16} stroke={1.9} aria-hidden="true" /> {state === 'busy' ? t.busy : t.label}
    </button>
    {state === 'done' || state === 'wait' || state === 'failed' ? <span role={state === 'failed' ? 'alert' : 'status'} className="small-note"> {t[state]}</span> : null}
  </span>;
}
