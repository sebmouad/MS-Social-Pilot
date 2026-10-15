'use client';

import { useCallback, useEffect, useState } from 'react';
import styles from '../publishing.module.css';

type ImageItem = { id: string; mimeType: string; size: number; createdAt: string; inUse: boolean };
type ImagePage = { items: ImageItem[]; nextCursor: string | null };

export function MediaLibrary({ canDelete }: { canDelete: boolean }) {
  const [items, setItems] = useState<ImageItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(async (next?: string, append = false) => {
    if (append) setLoadingMore(true); else setBusy(true);
    setError('');
    try {
      const query = next ? `?cursor=${encodeURIComponent(next)}` : '';
      const response = await fetch(`/api/media${query}`, { cache: 'no-store' });
      const data = await response.json() as ImagePage & { error?: string };
      if (!response.ok) throw new Error(data.error || 'Could not load images.');
      setItems(current => append ? [...current, ...data.items] : data.items);
      setCursor(data.nextCursor);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load images.');
    } finally { setBusy(false); setLoadingMore(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function remove(image: ImageItem) {
    if (image.inUse || !window.confirm('Delete this stored image? This cannot be undone.')) return;
    setError('');
    try {
      const response = await fetch(`/api/media/${encodeURIComponent(image.id)}`, { method: 'DELETE' });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || 'Could not delete this image.');
      setItems(current => current.filter(item => item.id !== image.id));
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not delete this image.'); }
  }

  return <section className={`${styles.card} ${styles.mediaLibrary}`} aria-label="Stored images">
    {error ? <p className={styles.errorNotice} role="alert">{error}</p> : null}
    {busy ? <p className={styles.empty} role="status">Loading images…</p> : items.length === 0 ? <p className={styles.empty}>No images are stored in this workspace yet.</p> : <>
      <div className={styles.mediaGrid}>
        {items.map(image => <article className={styles.mediaCard} key={image.id}>
          <a className={styles.mediaPreview} href={`/api/media/${encodeURIComponent(image.id)}`} target="_blank" rel="noreferrer" aria-label="Open image preview">
            <img src={`/api/media/${encodeURIComponent(image.id)}`} alt="Stored workspace image" width={160} height={160} loading="lazy" />
          </a>
          <div className={styles.mediaDetails}>
            <span className={styles.mediaType}>{image.mimeType.replace('image/', '').toUpperCase()} · {formatBytes(image.size)}</span>
            <time dateTime={image.createdAt}>{new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(image.createdAt))}</time>
          </div>
          <div className={styles.mediaFooter}>
            <span className={styles.badge} data-status={image.inUse ? 'scheduled' : 'published'}>{image.inUse ? 'Used in a post' : 'Unused'}</span>
            {canDelete ? <button className="ui-button ui-button--secondary ui-button--sm" type="button" disabled={image.inUse} onClick={() => void remove(image)} aria-label="Delete unused image">Delete</button> : null}
          </div>
        </article>)}
      </div>
      {cursor ? <div className={styles.mediaMore}><button className="ui-button ui-button--secondary" type="button" disabled={loadingMore} onClick={() => void load(cursor, true)}>{loadingMore ? 'Loading…' : 'Load more images'}</button></div> : null}
    </>}
  </section>;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}
