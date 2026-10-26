'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button } from '@/components/Button';
import { inboxHref, type InboxLocation } from '../query';
import { InboxSelectionProvider, type SelectableItem } from './InboxSelection';
import { BulkBar } from './BulkBar';
import { useInboxCatalog } from './copy-context';
import type { InboxLocale } from './copy';
import styles from './inbox.module.css';

export type InboxRow = { key: string; content: ReactNode; selectable: SelectableItem | null };
export type InboxListContinuation = { ok: true; rows: InboxRow[]; olderCursor: string | null; total: number } | { ok: false };
type Props = {
  rows: InboxRow[]; olderCursor: string | null; total: number; location: InboxLocation;
  locale: InboxLocale; title: string; maxItems: number; pageLimit: number;
  loadMoreAction: (location: InboxLocation) => Promise<InboxListContinuation>;
};

/** Progressive enhancement of the same cursor read used by REST and MCP.
 * Row slots are rendered on the server; browser state owns only loaded pages and selection.
 * The caller keys this surface by current scope/data so refreshes discard old pages and reads.
 */
export function InboxList({ rows: initialRows, olderCursor: initialCursor, total: initialTotal, location, locale, title, maxItems, pageLimit, loadMoreAction }: Props) {
  const [rows, setRows] = useState(initialRows);
  const [cursor, setCursor] = useState(initialCursor);
  const [total, setTotal] = useState(initialTotal);
  const [pages, setPages] = useState(1);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const inFlight = useRef(false);
  const active = useRef(false);
  const scroll = useRef<HTMLDivElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const copy = useInboxCatalog('inboxCopy')[locale];
  const pageItems = useMemo(() => rows.flatMap(row => row.selectable ? [row.selectable] : []), [rows]);
  const canAppend = cursor !== null && pages < pageLimit;

  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const load = useCallback(async () => {
    if (inFlight.current || !canAppend || !active.current) return;
    inFlight.current = true; setBusy(true); setFailed(false);
    try {
      const result = await loadMoreAction({ ...location, cursor: cursor! });
      if (!active.current) return;
      // A repeated anchor cannot make progress; leave a deliberate paging path.
      if (!result.ok || result.olderCursor === cursor) { setFailed(true); return; }
      setRows(current => {
        const seen = new Set(current.map(row => row.key));
        return [...current, ...result.rows.filter(row => { if (seen.has(row.key)) return false; seen.add(row.key); return true; })];
      });
      setCursor(result.olderCursor); setTotal(result.total); setPages(current => current + 1);
    } catch { if (active.current) setFailed(true); }
    finally { inFlight.current = false; if (active.current) setBusy(false); }
  }, [canAppend, cursor, loadMoreAction, location]);

  useEffect(() => {
    if (!canAppend || failed || busy || typeof IntersectionObserver === 'undefined' || !sentinel.current) return;
    // Use the list's own viewport on desktop; CSS lets it follow the document on phones.
    let listening = true;
    const observer = new IntersectionObserver(entries => {
      if (listening && entries.some(entry => entry.isIntersecting)) void load();
    }, { root: scroll.current });
    observer.observe(sentinel.current);
    return () => { listening = false; observer.disconnect(); };
  }, [canAppend, failed, busy, load]);

  return <>
    <div className={styles.listHead}><h2>{title}</h2><span role="status" aria-live="polite">{rows.length >= total ? copy.itemsAll(total) : copy.items(rows.length, total)}</span></div>
    <InboxSelectionProvider pageItems={pageItems}>
      <div className={styles.listContent}>
        {pageItems.length ? <BulkBar locale={locale} maxItems={maxItems} /> : null}
        <div className={styles.listScroll} ref={scroll} role="region" aria-label={title} tabIndex={0} data-inbox-list-scroll>
          <ul className={styles.list} aria-busy={busy}>{rows.map(row => row.content)}</ul>
          <div className={styles.loadMore} ref={sentinel}>
            {failed ? <p role="alert">{copy.loadMoreError}</p> : null}
            {canAppend ? <Button variant="secondary" disabled={busy} aria-busy={busy} onClick={() => void load()}>{busy ? copy.loadingMore : copy.loadMore}</Button> : null}
            {cursor ? <a href={inboxHref({ ...location, cursor })} data-inbox-continue>{copy.continueOlder}</a> : null}
          </div>
        </div>
      </div>
    </InboxSelectionProvider>
  </>;
}
