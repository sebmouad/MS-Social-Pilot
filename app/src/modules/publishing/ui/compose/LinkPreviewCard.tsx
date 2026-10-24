'use client';
import { useEffect, useState } from 'react';
import { IconLink } from '@tabler/icons-react';
import { Button } from '@/components/Button';
import type { LinkPreview } from '@/modules/studio/content-tools/pure';
import { catalogGroup, composerCatalogDefaults, type ComposerCatalog } from '../../composer-catalog';
import styles from './PostComposer.module.css';

type Card = { status: 'ready'; preview: LinkPreview | null; cached: boolean } | { status: 'error' };

const fetchable = (link: string) => {
  try {
    const url = new URL(link.trim());
    return (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password ? url.toString() : null;
  } catch { return null; }
};

/**
 * Server-side Open Graph card for the composer's link field. A cached preview renders from the
 * cache only; a new or changed address is fetched once by the server (debounced), never per render.
 */
export function LinkPreviewCard({ link, locale, disabled, copyCatalog = composerCatalogDefaults }: { link: string; locale: 'en' | 'fr'; disabled: boolean; copyCatalog?: ComposerCatalog }) {
  const t = catalogGroup(copyCatalog, 'linkPreview', locale);
  const address = fetchable(link);
  const [card, setCard] = useState<Card | null>(null);
  const [loading, setLoading] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    if (!address || disabled) { setCard(null); setLoading(false); return; }
    let current = true;
    const controller = new AbortController();
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        // Re-renders read the cache; only a cache miss fetches, once per address.
        const cached = await fetch(`/api/publishing/link-preview?url=${encodeURIComponent(address)}`, { signal: controller.signal, cache: 'no-store' });
        if (cached.ok) {
          const body = (await cached.json()) as { preview: LinkPreview | null; cached: boolean };
          if (body.preview && current) { setCard({ status: 'ready', preview: body.preview, cached: true }); setLoading(false); return; }
        }
        const response = await fetch('/api/publishing/link-preview', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: address }), signal: controller.signal });
        if (!response.ok) throw new Error('unavailable');
        const body = (await response.json()) as { preview: LinkPreview | null; cached?: boolean };
        if (current) { setCard({ status: 'ready', preview: body.preview, cached: body.cached === true }); setLoading(false); }
      } catch { if (current) { setCard({ status: 'error' }); setLoading(false); } }
    }, 500);
    return () => { current = false; controller.abort(); clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, refresh]);
  if (!address) return null;
  return <div className={styles.linkPreview} aria-live="polite">
    <p className={styles.linkPreviewTitle}><IconLink size={14} aria-hidden="true" /> {t.title}</p>
    {loading && !card ? <p>{t.loading}</p>
      : !card || card.status === 'error' ? <>
        <p>{t.error}</p><Button type="button" size="sm" disabled={disabled} onClick={() => { setCard(null); setRefresh(value => value + 1); }}>{t.retry}</Button>
      </>
      : !card.preview ? <p>{t.unavailable}</p>
      : <article>
        {card.preview.imageUrl ? <img src={card.preview.imageUrl} alt="" referrerPolicy="no-referrer" /> : null}
        <p><strong>{card.preview.title ?? card.preview.url}</strong></p>
        {card.preview.description ? <p>{card.preview.description}</p> : null}
        <p><small>{card.preview.siteName ?? card.preview.url}{card.cached ? ` · ${t.cached}` : ''}</small></p>
      </article>}
  </div>;
}
