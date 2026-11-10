'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { IconRefresh } from '@tabler/icons-react';

const COPY = {
  en: { label: 'Sync now', busy: 'Syncing…', slow: 'Reading every Page and ad account; this can take a few minutes. You can keep working.', done: 'Up to date: latest figures read from your channels.', wait: 'A sync just ran. Try again in a minute.', failed: 'Could not sync. Try again.', interrupted: 'The sync was interrupted (the app was updated). Press Sync now again.', help: 'Read the latest figures from Facebook, Instagram and your ad accounts now instead of waiting for the next automatic sync.' },
  fr: { label: 'Synchroniser', busy: 'Synchronisation…', slow: 'Lecture de chaque Page et compte publicitaire ; cela peut prendre quelques minutes. Vous pouvez continuer à travailler.', done: 'À jour : derniers chiffres lus sur vos canaux.', wait: 'Une synchronisation vient d’avoir lieu. Réessayez dans une minute.', failed: 'Synchronisation impossible. Réessayez.', interrupted: 'La synchronisation a été interrompue (mise à jour de l’application). Appuyez de nouveau sur Synchroniser.', help: 'Lire maintenant les derniers chiffres de Facebook, Instagram et de vos comptes publicitaires, sans attendre la prochaine synchronisation automatique.' },
} as const;

/** Insights and Ads: fetch this workspace's figures now (a freshly connected Page otherwise waits for the next sync). */
export function SyncNowButton({ locale = 'en' }: { locale?: 'en' | 'fr' }) {
  const t = COPY[locale];
  const router = useRouter();
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'wait' | 'failed' | 'interrupted'>('idle');
  async function run() {
    if (state === 'busy') return;
    setState('busy');
    const response = await fetch('/api/analytics/sync', { method: 'POST' }).catch(() => null);
    if (!response?.ok) { setState(response?.status === 409 ? 'wait' : 'failed'); return; }
    // The sync runs on the server; follow it until it ends (a full read of every Page can take a few minutes).
    const started = Date.now();
    while (Date.now() - started < 15 * 60_000) {
      await new Promise(resolve => setTimeout(resolve, 3000));
      const poll = await fetch('/api/analytics/sync', { cache: 'no-store' }).catch(() => null);
      const body = poll?.ok ? await poll.json().catch(() => null) as { run?: { state?: string } | null } | null : null;
      const runState = body?.run?.state;
      if (runState === 'done') { setState('done'); router.refresh(); return; }
      // A server restart (an app update) forgets the run: say so instead of a bare failure.
      if (body?.run === null) { setState('interrupted'); return; }
      if (runState === 'failed' || (poll && !poll.ok)) { setState('failed'); return; }
    }
    setState('failed');
  }
  return <span className="sync-now">
    <button type="button" className="ui-button ui-button--secondary ui-button--md" onClick={run} disabled={state === 'busy'} aria-busy={state === 'busy'} title={t.help}>
      <IconRefresh size={16} stroke={1.9} aria-hidden="true" /> {state === 'busy' ? t.busy : t.label}
    </button>
    {state === 'busy' ? <span role="status" className="small-note"> {t.slow}</span> : null}
    {state === 'done' || state === 'wait' || state === 'failed' || state === 'interrupted' ? <span role={state === 'failed' || state === 'interrupted' ? 'alert' : 'status'} className="small-note"> {t[state]}</span> : null}
  </span>;
}
