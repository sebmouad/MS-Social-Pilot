'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/Button';

type Status = { available: boolean; kinds: string[]; tones: string[]; maxInputCharacters: number | null };
const LABEL: Record<string, string> = { caption: 'Write a post about this', improve: 'Improve wording', translate: 'Translate', hashtags: 'Suggest hashtags' };

/** Composer helper. Renders nothing unless the installation offers AI assist to this member; never saves or posts. */
export function AiAssist({ text, onUse }: { text: string; onUse: (suggestion: string, kind: string) => void }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [kind, setKind] = useState('improve'); const [tone, setTone] = useState(''); const [language, setLanguage] = useState('');
  const [busy, setBusy] = useState(false); const [result, setResult] = useState<{ kind: string; text: string } | null>(null); const [error, setError] = useState('');
  const inFlight = useRef(false);
  useEffect(() => { let live = true; fetch('/api/ai').then(r => r.ok ? r.json() : null).then(b => { if (live && b && typeof b.available === 'boolean') setStatus(b); }).catch(() => undefined); return () => { live = false; }; }, []);
  if (!status?.available) return null;
  async function generate() {
    if (inFlight.current) return;
    if (!text.trim()) { setError('Write something first, then choose what AI assist should do.'); return; }
    if (kind === 'translate' && !language.trim()) { setError('Choose a language to translate into.'); return; }
    inFlight.current = true; setBusy(true); setError(''); setResult(null);
    try {
      const response = await fetch('/api/ai', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind, text, ...(tone ? { tone } : {}), ...(kind === 'translate' ? { language: language.trim() } : {}) }) });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body || typeof body.text !== 'string') throw new Error(body && typeof body.error === 'string' ? body.error : 'AI assist could not complete this request.');
      setResult({ kind: body.kind, text: body.text });
    } catch (e) { setError(e instanceof Error && !(e instanceof TypeError) ? e.message : 'AI assist could not be reached. Your text is unchanged.'); }
    finally { setBusy(false); inFlight.current = false; }
  }
  return <section aria-label="AI writing assist">
    <label>Assist<select value={kind} disabled={busy} onChange={e => setKind(e.target.value)}>{status.kinds.map(k => <option key={k} value={k}>{LABEL[k] ?? k}</option>)}</select></label>
    {kind !== 'hashtags' && <label>Tone <span>(optional)</span><select value={tone} disabled={busy} onChange={e => setTone(e.target.value)}><option value="">Keep as is</option>{status.tones.map(t => <option key={t} value={t}>{t}</option>)}</select></label>}
    {kind === 'translate' && <label>Language<input value={language} disabled={busy} maxLength={32} onChange={e => setLanguage(e.target.value)} /></label>}
    <Button type="button" disabled={busy} onClick={() => void generate()}>{busy ? 'Working…' : 'Get suggestion'}</Button>
    {error && <p role="alert">{error}</p>}
    {result && <div role="status"><p style={{ whiteSpace: 'pre-wrap' }}>{result.text}</p><Button type="button" variant="primary" onClick={() => { onUse(result.text, result.kind); setResult(null); }}>Use this text</Button> <Button type="button" onClick={() => setResult(null)}>Discard</Button></div>}
  </section>;
}
