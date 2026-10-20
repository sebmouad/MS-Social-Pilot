'use client';

import { useEffect } from 'react';

const TYPING = /^(input|textarea|select)$/i;

/**
 * Helpdesk keys without a mouse: j/k move between conversations, r jumps to the reply
 * box, e resolves or reopens. Ignored while typing, with modifier keys, or when a dialog
 * is open. Every key only focuses or clicks a control that already exists on the page,
 * so permissions and confirmations stay in the shared actions.
 */
export function InboxShortcuts() {
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
  return null;
}
