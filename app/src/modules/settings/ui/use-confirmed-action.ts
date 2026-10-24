'use client';
import { useRef } from 'react';
/** Keep one confirmation pending through repeated clicks in the same React render. */
export function useConfirmedAction() {
  const pending = useRef<Promise<string | null> | null>(null);
  return (action: () => Promise<string | null>) => {
    if (!pending.current) pending.current = action().finally(() => { pending.current = null; });
    return pending.current;
  };
}
