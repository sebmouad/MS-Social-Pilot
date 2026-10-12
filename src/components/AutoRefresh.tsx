'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/** Re-reads the server component every few seconds while something is being built. Renders nothing. */
export function AutoRefresh({ seconds }: { seconds: number }) {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => router.refresh(), seconds * 1000);
    return () => clearInterval(timer);
  }, [router, seconds]);
  return null;
}
