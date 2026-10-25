'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/Button';
import { Dialog } from '@/components/Dialog';
import { useContent } from '../ContentProvider';
import { fillContent } from '../content-copy';
import styles from './LibraryPicker.module.css';

type Listing = { id: string };
type State = { status: 'loading' } | { status: 'error' } | { status: 'ready'; items: Listing[]; next: string | null };

/**
 * Pick images that already live in the workspace library. It reads the same media listing the Library tab uses
 * (`GET /api/media`, tenant- and permission-checked by the server), one page at a time.
 */
export function LibraryPicker({ open, onClose, onAdd, maxSelect }: { open: boolean; onClose: () => void; onAdd: (ids: string[]) => void; maxSelect: number }) {
  const { copy } = useContent();
  const [state, setState] = useState<State>({ status: 'loading' });
  const [selected, setSelected] = useState<string[]>([]);
  const request = useRef(0);

  const load = useCallback(async (cursor?: string) => {
    const id = ++request.current;
    if (!cursor) setState({ status: 'loading' });
    try {
      const response = await fetch(`/api/media${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`, { cache: 'no-store' });
      if (!response.ok) throw new Error('unavailable');
      const body = await response.json() as { items?: Listing[]; nextCursor?: string | null };
      if (!Array.isArray(body.items)) throw new Error('unavailable');
      if (id !== request.current) return;
      setState(previous => ({ status: 'ready', items: [...(cursor && previous.status === 'ready' ? previous.items : []), ...body.items!.map(item => ({ id: item.id }))], next: body.nextCursor ?? null }));
    } catch {
      if (id === request.current) setState({ status: 'error' });
    }
  }, []);

  useEffect(() => { if (open) { setSelected([]); void load(); } else request.current++; }, [open, load]);

  const toggle = (id: string) => setSelected(current => current.includes(id) ? current.filter(item => item !== id) : current.length >= maxSelect ? current : [...current, id]);
  return <Dialog open={open} title={copy.createLibraryTitle} description={copy.createLibraryHint} onClose={onClose}
    actions={<><Button data-dialog-cancel variant="secondary" onClick={onClose}>{copy.createPublishCancel}</Button><Button variant="primary" disabled={!selected.length} onClick={() => { onAdd(selected); onClose(); }}>{fillContent(copy.createLibraryAdd, { count: selected.length })}</Button></>}>
    {state.status === 'loading' ? <p role="status">{copy.createLibraryLoading}</p>
      : state.status === 'error' ? <div role="alert"><p>{copy.createLibraryError}</p><Button size="sm" onClick={() => void load()}>{copy.createLibraryMore}</Button></div>
      : !state.items.length ? <p>{copy.createLibraryEmpty}</p>
      : <>
        <ul className={styles.grid}>{state.items.map((item, index) => {
          const on = selected.includes(item.id);
          return <li key={item.id}>
            <button type="button" className={`${styles.tile}${on ? ` ${styles.on}` : ''}`} aria-pressed={on} aria-label={fillContent(copy.createLibraryImage, { name: String(index + 1) })} onClick={() => toggle(item.id)}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/media/${encodeURIComponent(item.id)}?w=320`} alt="" loading="lazy" />
            </button>
          </li>;
        })}</ul>
        {state.next ? <Button size="sm" variant="secondary" onClick={() => void load(state.next!)}>{copy.createLibraryMore}</Button> : null}
      </>}
  </Dialog>;
}
