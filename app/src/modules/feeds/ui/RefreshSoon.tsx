'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Asks the server for the page again while a figure is still being worked out (2026-11-17): the recipe count takes
 * about a minute after a restart. Unmounted once the figure arrives; a few tries at most. Forms keep what was typed.
 */
export function RefreshSoon({ everyMs = 30_000, tries = 4 }: { everyMs?: number; tries?: number }) {
  const router = useRouter();
  useEffect(() => {
    let left = tries;
    const timer = setInterval(() => { if (left-- <= 0) clearInterval(timer); else router.refresh(); }, everyMs);
    return () => clearInterval(timer);
  }, [router, everyMs, tries]);
  return null;
}
