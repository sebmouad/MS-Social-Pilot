'use client';
import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { registerNavigationGuard } from '@/lib/navigation-guard';
import { useConfirm, type ConfirmOptions } from './ConfirmProvider';

/** Shared leave protection; callers decide whether recovery may store their data. */
export function useUnsavedChanges(dirty: boolean, options: ConfirmOptions | (() => ConfirmOptions)) {
  const confirm = useConfirm();
  const router = useRouter();
  const latest = useRef(options); latest.current = options;
  useEffect(() => {
    if (!dirty) return;
    let pending: Promise<boolean> | null = null;
    const ask = () => pending ??= confirm(typeof latest.current === 'function' ? latest.current() : latest.current).finally(() => { pending = null; });
    const unregister = registerNavigationGuard(ask);
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    const click = (event: MouseEvent) => {
      const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null;
      if (!anchor || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || anchor.target === '_blank' || anchor.hasAttribute('download')) return;
      const to = new URL(anchor.href, location.href);
      if (to.origin !== location.origin || (to.pathname === location.pathname && to.search === location.search)) return;
      event.preventDefault(); event.stopPropagation();
      void ask().then(leave => { if (leave) router.push(to.pathname + to.search + to.hash); });
    };
    type TraverseEvent = Event & { navigationType: string; destination: { key: string } };
    const navigation = (window as unknown as { navigation?: EventTarget & { traverseTo: (key: string) => unknown } }).navigation;
    let approved = false;
    const traverse = (raw: Event) => {
      const event = raw as TraverseEvent;
      if (event.navigationType !== 'traverse' || !event.cancelable) return;
      if (approved) { approved = false; return; }
      event.preventDefault();
      void ask().then(leave => { if (leave) { approved = true; navigation?.traverseTo(event.destination.key); } });
    };
    window.addEventListener('beforeunload', warn);
    document.addEventListener('click', click, true);
    navigation?.addEventListener('navigate', traverse);
    return () => { unregister(); window.removeEventListener('beforeunload', warn); document.removeEventListener('click', click, true); navigation?.removeEventListener('navigate', traverse); };
  }, [dirty, confirm, router]);
}
