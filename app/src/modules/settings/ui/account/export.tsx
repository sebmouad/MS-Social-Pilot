'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/Button';
import { useSettingsCopy } from '../copy-context';
import styles from '../settings.module.css';

/** Personal JSON download; workspace ZIP controls have a different coverage contract. */
const EXPORT_DESCRIBED_BY = ['account-export-coverage', 'account-export-exclusions'].join(' ');

export function AccountExport({ locale = 'en', maxBytes }: { locale?: 'en' | 'fr'; maxBytes: number }) {
  const t = useSettingsCopy('account', locale);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ error: boolean; text: string } | null>(null);
  const active = useRef<AbortController | null>(null);
  const feedbackRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => () => { active.current?.abort(); active.current = null; }, []);
  useEffect(() => { if (feedback?.error) feedbackRef.current?.focus(); }, [feedback]);

  async function download() {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    const current = () => active.current === controller && !controller.signal.aborted;
    setBusy(true); setFeedback(null);
    try {
      const response = await fetch('/api/settings/account/export', { cache: 'no-store', signal: controller.signal });
      if (!current()) return;
      if (!response.ok) {
        const failure = await response.json().catch(() => null) as { code?: string } | null;
        if (!current()) return;
        const text = response.status === 401 ? t.exportSignIn : response.status === 403 ? t.exportForbidden : failure?.code === 'unavailable' ? t.exportUnavailable : t.exportFailed;
        setFeedback({ error: true, text });
        return;
      }
      const declared = response.headers.get('content-length');
      const bytes = Number(declared);
      if (response.redirected || response.headers.get('content-type')?.split(';')[0].trim() !== 'application/json' ||
        response.headers.get('content-disposition') !== 'attachment' || !declared || !/^\d+$/.test(declared) ||
        !Number.isSafeInteger(bytes) || bytes <= 0 || bytes > maxBytes) throw new Error('Unconfirmed export');
      const content = await response.text();
      if (!current()) return;
      const snapshot = JSON.parse(content);
      // Serialization identifiers belong to the service protocol, not operational policy.
      if (snapshot?.format !== 'ms-social-pilot-account-export' || snapshot.version !== 1 || snapshot.coverage?.complete !== false ||
        !Array.isArray(snapshot.coverage.included) || !Array.isArray(snapshot.coverage.excluded)) throw new Error('Unconfirmed coverage');
      const blob = new Blob([content], { type: 'application/json' });
      if (blob.size !== bytes || blob.size > maxBytes) throw new Error('Unconfirmed bytes');
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      try {
        anchor.href = url; anchor.download = t.exportFileName; anchor.hidden = true;
        document.body.append(anchor); anchor.click();
      } finally {
        anchor.remove(); URL.revokeObjectURL(url);
      }
      setFeedback({ error: false, text: t.exportReady });
    } catch {
      if (current()) setFeedback({ error: true, text: t.exportFailed });
    } finally {
      if (current()) { active.current = null; setBusy(false); }
    }
  }

  return <section className={styles['settings-panel']} aria-labelledby="account-export-title">
    <div className={styles['settings-panel__heading']}><div><h2 id="account-export-title">{t.exportTitle}</h2><p id="account-export-coverage">{t.exportCoverage}</p></div></div>
    <p id="account-export-exclusions" className={styles['settings-note']}>{t.exportExclusions}</p>
    <Button onClick={download} disabled={busy} aria-busy={busy} aria-describedby={EXPORT_DESCRIBED_BY}>{busy ? t.exportPending : t.exportDownload}</Button>
    {feedback && <p ref={feedbackRef} tabIndex={-1} role={feedback.error ? 'alert' : 'status'} className={feedback.error ? 'ui-error' : styles['settings-note']}>{feedback.text}</p>}
  </section>;
}
