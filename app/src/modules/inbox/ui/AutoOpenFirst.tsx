'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * On wide screens the Inbox opens the first item that needs a reply instead of an empty « Select a conversation »
 * pane. Phones keep the list first (the thread would cover it). The address is replaced, so Back leaves the Inbox.
 */
export function AutoOpenFirst({ href }: { href: string }) {
  const router = useRouter();
  useEffect(() => {
    if (window.matchMedia('(min-width: 1024px)').matches) router.replace(href, { scroll: false });
  }, [href, router]);
  return null;
}
