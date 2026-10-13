'use client';
import { useEffect, useRef, type RefObject } from 'react';

const stack: HTMLElement[] = [];
const inertLocks = new Map<HTMLElement, { count: number; original: boolean }>();
let originalOverflow = '';
function isolate(element: HTMLElement) {
  const lock = inertLocks.get(element);
  if (lock) lock.count++;
  else inertLocks.set(element, { count: 1, original: Boolean(element.inert) });
  element.inert = true;
}
function release(element: HTMLElement) {
  const lock = inertLocks.get(element);
  if (!lock) return;
  if (--lock.count === 0) { element.inert = lock.original; inertLocks.delete(element); }
}
/** Shared modal keyboard containment, background isolation and focus restoration. */
export function useModalFocus(panel: RefObject<HTMLElement | null>, open: boolean, onClose: () => void) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const element = panel.current;
    if (!open || !element) return;
    const opener = document.activeElement as HTMLElement | null;
    if (stack.length === 0) originalOverflow = document.body.style.overflow;
    const isolated: HTMLElement[] = [];
    let ancestor: HTMLElement = element;
    while (ancestor.parentElement && ancestor.parentElement !== document.body) {
      for (const sibling of ancestor.parentElement.children) {
        if (sibling !== ancestor && sibling instanceof HTMLElement) {
          isolated.push(sibling);
          isolate(sibling);
        }
      }
      ancestor = ancestor.parentElement;
    }
    if (ancestor.parentElement === document.body) {
      for (const sibling of document.body.children) {
        if (sibling !== ancestor && sibling instanceof HTMLElement) {
          isolated.push(sibling);
          isolate(sibling);
        }
      }
    }
    stack.push(element);
    document.body.style.overflow = 'hidden';
    const candidates = () => Array.from(element.querySelectorAll<HTMLElement>('a[href],button,input,select,textarea,[tabindex]')).filter((node) => !node.matches(':disabled,[tabindex="-1"]') && !node.closest('[inert]') && node.getClientRects().length > 0);
    const focusFirst = () => (candidates()[0] ?? element).focus();
    focusFirst();
    const key = (event: KeyboardEvent) => {
      if (stack.at(-1) !== element) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close.current(); }
      if (event.key !== 'Tab') return;
      const nodes = candidates();
      const first = nodes[0]; const last = nodes.at(-1);
      if (!first || (event.shiftKey && (document.activeElement === first || document.activeElement === element)) || (!event.shiftKey && document.activeElement === last)) {
        event.preventDefault(); (event.shiftKey ? last ?? element : first ?? element).focus();
      }
    };
    const contain = (event: FocusEvent) => { if (stack.at(-1) === element && !element.contains(event.target as Node)) focusFirst(); };
    document.addEventListener('keydown', key, true);
    document.addEventListener('focusin', contain);
    return () => {
      document.removeEventListener('keydown', key, true);
      document.removeEventListener('focusin', contain);
      stack.splice(stack.lastIndexOf(element), 1);
      isolated.forEach(release);
      if (stack.length === 0) document.body.style.overflow = originalOverflow;
      if (opener?.isConnected && !opener.closest('[inert]')) opener.focus();
    };
  }, [open, panel]);
}
