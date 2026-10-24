'use client';

import { useRef, useState } from 'react';
import { IconSparkles } from '@tabler/icons-react';
import { Button } from '@/components/Button';
import { aiCopy } from '../copy';

/**
 * Suggest a description for one stored image. It only proposes text into the field the member is
 * editing; nothing is saved or posted until the member saves the post.
 */
export function AltTextSuggest({ imageId, locale = 'en', disabled = false, onSuggestion }: { imageId: string; locale?: 'en' | 'fr'; disabled?: boolean; onSuggestion: (text: string) => void }) {
  const c = aiCopy[locale].altText;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inFlight = useRef(false);
  async function suggest() {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError('');
    try {
      const response = await fetch('/api/ai/alt-text', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ imageId, language: locale === 'fr' ? 'French' : 'English' }) });
      const body = await response.json().catch(() => null);
      if (!response.ok || typeof body?.text !== 'string') throw new Error(typeof body?.error === 'string' ? body.error : c.failed);
      onSuggestion(body.text);
    } catch (failure) { setError(failure instanceof Error ? failure.message : c.failed); }
    finally { inFlight.current = false; setBusy(false); }
  }
  return <div>
    <Button size="sm" variant="quiet" leading={<IconSparkles size={14} />} disabled={disabled} busy={busy} onClick={suggest}>{busy ? c.working : c.suggest}</Button>
    {error ? <p role="alert">{error}</p> : <small>{c.note}</small>}
  </div>;
}
