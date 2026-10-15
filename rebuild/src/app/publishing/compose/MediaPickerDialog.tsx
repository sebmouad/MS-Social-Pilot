'use client';

import { useCallback, useEffect, useId, useState } from 'react';
import { Button } from '@/components/Button';
import { ModalDialog } from '@/components/ModalDialog';
import styles from './compose.module.css';

type LibraryImage = { id: string; mimeType: string; size: number; createdAt: string; inUse: boolean };
type LibraryPage = { items: LibraryImage[]; nextCursor: string | null; error?: string };

function sizeLabel(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const mb = bytes / 1048576;
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}

/** Choose one image already stored in the workspace library. */
export function MediaPickerDialog({ onPick, onClose, onUploadFile, accept }: {
  onPick: (image: { id: string }) => void;
  onClose: () => void;
  onUploadFile: (file: File) => void;
  accept: string;
}) {
  const titleId = useId();
  const [items, setItems] = useState<LibraryImage[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async (next?: string) => {
    if (next) setMore(true); else setLoading(true);
    setError('');
    try {
      const response = await fetch(`/api/media${next ? `?cursor=${encodeURIComponent(next)}` : ''}`, { cache: 'no-store' });
      const data = await response.json().catch(() => ({})) as LibraryPage;
      if (!response.ok) throw new Error(data.error || 'The image library could not be loaded.');
      setItems(current => next ? [...current, ...data.items] : data.items);
      setCursor(data.nextCursor);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The image library could not be loaded.');
    } finally { setLoading(false); setMore(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const upload = <label className="ui-button ui-button--secondary">
    <span>Upload an image</span>
    <input className="ui-visually-hidden" type="file" accept={accept} onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (file) onUploadFile(file); }} />
  </label>;

  return <ModalDialog className={`ui-dialog ${styles.pickerDialog}`} labelledBy={titleId} onDismiss={onClose}>
    <div className="ui-dialog__header">
      <div><h2 id={titleId}>Choose from the image library</h2><p>Images stored in this workspace. Pick one to attach it to the post.</p></div>
      <Button variant="quiet" size="sm" data-dialog-cancel onClick={onClose}>Close</Button>
    </div>
    <div className="ui-dialog__body">
      {error ? <p className="ui-notice ui-notice--danger" role="alert">{error} <button className="ui-button ui-button--quiet ui-button--sm" type="button" onClick={() => void load()}>Try again</button></p> : null}
      {loading ? <p className={styles.muted} role="status">Loading images…</p> : null}
      {!loading && !error && items.length === 0 ? <div className="ui-empty" role="status">
        <h3>No images yet</h3>
        <p>Images you upload are saved here so you can reuse them in later posts.</p>
        {upload}
      </div> : null}
      {items.length ? <>
        <ul className={styles.pickerGrid}>
          {items.map(image => <li key={image.id}>
            <button type="button" className={styles.pickerItem} onClick={() => onPick(image)} aria-label={`Use image, ${image.mimeType.replace('image/', '').toUpperCase()}, ${sizeLabel(image.size)}, added ${new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(image.createdAt))}`}>
              <img src={`/api/media/${encodeURIComponent(image.id)}`} alt="" width={140} height={140} loading="lazy" />
              <span>{image.mimeType.replace('image/', '').toUpperCase()} · {sizeLabel(image.size)}</span>
            </button>
          </li>)}
        </ul>
        <div className={styles.pickerFooter}>
          {cursor ? <Button disabled={more} onClick={() => void load(cursor)}>{more ? 'Loading…' : 'Load more images'}</Button> : <span />}
          {upload}
        </div>
      </> : null}
    </div>
  </ModalDialog>;
}
