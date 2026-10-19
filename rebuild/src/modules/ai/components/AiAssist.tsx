'use client';

import { useRef, useState } from 'react';
import { Button } from '@/components/Button';
import { aiCopy } from '../copy';
import styles from './AiAssist.module.css';

type Status = { available: boolean; kinds: readonly string[]; tones: readonly string[]; maxInputCharacters: number | null };
type Kind = keyof typeof aiCopy.en.kinds;
type Tone = keyof typeof aiCopy.en.tones;

/**
 * Composer helper. The server passes `status` (from aiStatus); the component renders nothing unless the
 * installation, the workspace and this member's access offer AI assist. It only ever proposes text: the member must press "Use this text"; it never saves,
 * schedules, sends or posts anything.
 */
export function AiAssist({ status, text, onUse, disabled = false, locale = 'en' }: { status?: Status; text: string; onUse: (suggestion: string, kind: string) => void; disabled?: boolean; locale?: 'en' | 'fr' }) {
  const c = aiCopy[locale];
  const [kind, setKind] = useState('improve'); const [tone, setTone] = useState(''); const [language, setLanguage] = useState('');
  const [busy, setBusy] = useState(false); const [result, setResult] = useState<{ kind: string; text: string } | null>(null); const [error, setError] = useState('');
  const inFlight = useRef(false);
  if (!status?.available) return null;
  async function generate() {
    if (inFlight.current) return;
    if (!text.trim()) { setError(c.needText); return; }
    if (kind === 'translate' && !language.trim()) { setError(c.needLanguage); return; }
    inFlight.current = true; setBusy(true); setError(''); setResult(null);
    try {
      const response = await fetch('/api/ai', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind, text, ...(tone && kind !== 'hashtags' ? { tone } : {}), ...(kind === 'translate' ? { language: language.trim() } : {}) }) });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body || typeof body.text !== 'string') throw new Error(body && typeof body.error === 'string' ? body.error : c.failed);
      setResult({ kind: body.kind, text: body.text });
    } catch (e) { setError(e instanceof Error && !(e instanceof TypeError) ? e.message : c.unreachable); }
    finally { setBusy(false); inFlight.current = false; }
  }
  const kindLabel = (k: string) => c.kinds[k as Kind] ?? k;
  return <section className={styles.assist} aria-label={c.region}>
    <h3>{c.heading}</h3>
    <p className={styles.note}>{c.note}</p>
    <div className={styles.row}>
      <label className={styles.field}>{c.assist}<select value={kind} disabled={busy || disabled} onChange={e => { setKind(e.target.value); setResult(null); }}>{status.kinds.map(k => <option key={k} value={k}>{kindLabel(k)}</option>)}</select></label>
      {kind !== 'hashtags' && <label className={styles.field}><span>{c.tone} {c.toneOptional}</span><select value={tone} disabled={busy || disabled} onChange={e => setTone(e.target.value)}><option value="">{c.toneKeep}</option>{status.tones.map(t => <option key={t} value={t}>{c.tones[t as Tone] ?? t}</option>)}</select></label>}
      {kind === 'translate' && <label className={styles.field}>{c.language}<input value={language} disabled={busy || disabled} maxLength={32} placeholder={c.languageHint} onChange={e => setLanguage(e.target.value)} /></label>}
      <Button type="button" disabled={busy || disabled} onClick={() => void generate()}>{busy ? c.working : c.run}</Button>
    </div>
    {error && <p className={styles.error} role="alert">{error}</p>}
    {result && <div className={styles.result} role="status" aria-label={c.suggestion}>
      <p>{result.text}</p>
      <div className={styles.actions}>
        <Button type="button" variant="primary" disabled={disabled} onClick={() => { onUse(result.text, result.kind); setResult(null); }}>{result.kind === 'hashtags' ? c.useAppend : c.useReplace}</Button>
        <Button type="button" onClick={() => setResult(null)}>{c.discard}</Button>
      </div>
    </div>}
  </section>;
}
