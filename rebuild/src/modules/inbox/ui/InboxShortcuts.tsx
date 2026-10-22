'use client';
import { useInboxCatalog } from './copy-context';

import { useEffect, useState } from 'react';
import { IconKeyboard } from '@tabler/icons-react';
import { Button, Dialog, ShortcutHint } from '@/components';
import type { InboxLocale } from './copy';
import styles from './inbox-round3.module.css';

const TYPING = /^(input|textarea|select)$/i;

/**
 * Helpdesk keys without a mouse: j/k move between conversations, x selects the focused one, r jumps to the
 * reply box, e resolves or reopens, / searches and ? lists them all. Ignored while typing, with modifier keys, or
 * when a dialog is open. Every key only focuses or clicks a control that already exists on the page, so
 * permissions and confirmations stay in the shared actions. The same keys are listed in the guide this button opens.
 */
export function InboxShortcuts({ locale = 'en' }: { locale?: InboxLocale }) {
  const copy = useInboxCatalog('round3Copy')[locale].shortcuts;
  const [guide, setGuide] = useState(false);
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (TYPING.test(target.tagName) || target.isContentEditable)) return;
      if (document.querySelector('dialog[open], [role="dialog"]')) return;
      const key = event.key.toLowerCase();
      if (key === 'j' || key === 'k') {
        const items = Array.from(document.querySelectorAll<HTMLElement>('[data-inbox-item]'));
        if (!items.length) return;
        const current = items.findIndex(item => item === document.activeElement || item.getAttribute('aria-current') === 'true');
        const next = key === 'j' ? Math.min(items.length - 1, current + 1) : Math.max(0, current < 0 ? 0 : current - 1);
        event.preventDefault();
        items[next]?.focus();
        items[next]?.scrollIntoView({ block: 'nearest' });
      } else if (key === 'x') {
        // The checkbox that sits beside the focused (or open) conversation row.
        const row = document.activeElement instanceof HTMLElement ? document.activeElement.closest('li') : null;
        const box = (row ?? document.querySelector('[data-inbox-item][aria-current="true"]')?.closest('li'))?.querySelector<HTMLInputElement>('input[data-inbox-select]');
        if (!box) return;
        event.preventDefault();
        box.click();
      } else if (key === '/') {
        const search = document.querySelector<HTMLInputElement>('input[name="q"]');
        if (!search) return;
        event.preventDefault();
        search.focus();
      } else if (key === '?') {
        event.preventDefault();
        setGuide(true);
      } else if (key === 'r') {
        const reply = document.querySelector<HTMLTextAreaElement>('textarea[data-inbox-reply]:not(:disabled)');
        if (!reply) return;
        event.preventDefault();
        reply.focus();
      } else if (key === 'e') {
        const resolve = document.querySelector<HTMLButtonElement>('button[data-inbox-resolve]:not(:disabled)');
        if (!resolve) return;
        event.preventDefault();
        resolve.click();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  const rows: Array<[string, Array<[string, string]>]> = [
    [copy.groups.move, [['j', copy.keys.next], ['k', copy.keys.previous], ['/', copy.keys.search]]],
    [copy.groups.act, [['r', copy.keys.reply], ['e', copy.keys.resolve], ['?', copy.keys.help]]],
    [copy.groups.select, [['x', copy.keys.select], ['escape', copy.keys.clear]]],
  ];
  return <>
    <Button variant="quiet" size="sm" leading={<IconKeyboard size={18} stroke={1.75} aria-hidden="true" />} aria-label={copy.open} title={copy.open} onClick={() => setGuide(true)} />
    <Dialog open={guide} title={copy.title} description={copy.description} closeLabel={copy.close} onClose={() => setGuide(false)}>
      <div className={styles.keys}>
        {rows.map(([group, entries]) => <section key={group}><h3>{group}</h3><dl>
          {entries.map(([chord, label]) => <div key={chord}><dt>{label}</dt><dd><ShortcutHint chord={chord} /></dd></div>)}
        </dl></section>)}
      </div>
    </Dialog>
  </>;
}
