'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import styles from './inbox-round3.module.css';

/** What the bulk bar needs to know about one selectable item; all of it was decided on the server for the signed-in person. */
export type SelectableItem = {
  key: string; kind: 'message' | 'comment' | 'review'; id: string; label: string; platformName: string;
  resolved: boolean; hidden: boolean; can: { resolve: boolean; hide: boolean; remove: boolean; assign: boolean };
};
type Selection = {
  items: Map<string, SelectableItem>;
  toggle: (item: SelectableItem) => void;
  has: (key: string) => boolean;
  replace: (keys: readonly string[]) => void;
  clear: () => void;
  selectPage: () => void;
  pageItems: readonly SelectableItem[];
};
const SelectionContext = createContext<Selection | null>(null);

/** Selection lives only on the page that shows it; changing filters or pages starts clean, so nothing off-screen is ever acted on. */
export function InboxSelectionProvider({ pageItems, children }: { pageItems: readonly SelectableItem[]; children: ReactNode }) {
  const [selected, setItems] = useState<Map<string, SelectableItem>>(() => new Map());
  // Render only current visible rows and their latest permissions. A server refresh
  // must never leave stale authorization metadata in a bulk action payload.
  const items = useMemo(() => new Map(pageItems.filter(item => selected.has(item.key)).map(item => [item.key, item])), [pageItems, selected]);
  useEffect(() => {
    const visible = new Set(pageItems.map(item => item.key));
    setItems(current => [...current.keys()].some(key => !visible.has(key))
      ? new Map([...current].filter(([key]) => visible.has(key))) : current);
  }, [pageItems]);
  const toggle = useCallback((item: SelectableItem) => setItems(current => { const next = new Map(current); if (next.has(item.key)) next.delete(item.key); else next.set(item.key, item); return next; }), []);
  const replace = useCallback((keys: readonly string[]) => setItems(current => { const next = new Map<string, SelectableItem>(); for (const key of keys) { const found = current.get(key); if (found) next.set(key, found); } return next; }), []);
  const clear = useCallback(() => setItems(new Map()), []);
  const selectPage = useCallback(() => setItems(new Map(pageItems.map(item => [item.key, item]))), [pageItems]);
  const value = useMemo<Selection>(() => ({ items, toggle, has: key => items.has(key), replace, clear, selectPage, pageItems }), [items, toggle, replace, clear, selectPage, pageItems]);
  return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>;
}

export function useInboxSelection() {
  const value = useContext(SelectionContext);
  if (!value) throw new Error('Inbox selection is unavailable outside its provider.');
  return value;
}

/** Checkbox at the start of a list row. It sits beside the row link, so opening a conversation stays one click. */
export function SelectBox({ item, label }: { item: SelectableItem; label: string }) {
  const selection = useInboxSelection();
  return <input type="checkbox" className={styles.selectBox} data-inbox-select aria-label={label} checked={selection.has(item.key)} onChange={() => selection.toggle(item)} />;
}
