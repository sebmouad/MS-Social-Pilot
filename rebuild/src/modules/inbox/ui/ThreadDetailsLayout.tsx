'use client';
import { useEffect, useState, type ReactNode } from 'react';
import { IconLayoutSidebarRight } from '@tabler/icons-react';
import { useInboxCatalog } from './copy-context';
import type { InboxLocale } from './copy';
import r3 from './inbox-round3.module.css';
import styles from './inbox.module.css';

const WIDE = '(min-width: 1280px)';

/**
 * The open thread beside its details pane (design v2 S8). From 1280 px the 320 px pane sits next to the thread and can be
 * collapsed; below that it is a drawer opened from the same toggle. The pane stays mounted, so closing it never loses state.
 */
export function ThreadDetailsLayout({ head, actions, main, details, locale = 'en' }: { head: ReactNode; actions?: ReactNode; main: ReactNode; details: ReactNode; locale?: InboxLocale }) {
  const copy = useInboxCatalog('round3Copy')[locale].screen;
  const [collapsed, setCollapsed] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [isWide, setIsWide] = useState(true);
  useEffect(() => {
    const query = window.matchMedia(WIDE);
    const sync = () => { setIsWide(query.matches); setDrawer(false); };
    setIsWide(query.matches);
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);
  const shown = isWide ? !collapsed : drawer;
  useEffect(() => {
    if (!drawer) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setDrawer(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [drawer]);
  const toggle = () => { if (isWide) setCollapsed(value => !value); else setDrawer(value => !value); };
  return <>
    <div className={styles.threadHeadRow}>
      {head}
      <div className={styles.threadHeadActions}>
        {actions}
        <button type="button" className={styles.detailsToggle} aria-expanded={shown} aria-controls="inbox-details" onClick={toggle}>
          <IconLayoutSidebarRight size={18} stroke={1.75} aria-hidden="true" /><span>{shown ? copy.detailsHide : copy.detailsShow}</span>
        </button>
      </div>
    </div>
    <div className={r3.threadGrid} data-collapsed={collapsed || undefined} data-drawer={drawer || undefined}>
      <div className={r3.threadMain}>{main}</div>
      {drawer ? <button type="button" className={r3.detailsScrim} aria-label={copy.detailsDrawerClose} tabIndex={-1} onClick={() => setDrawer(false)} /> : null}
      <div id="inbox-details" className={r3.detailsSlot}>{details}</div>
    </div>
  </>;
}
