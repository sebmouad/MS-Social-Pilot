"use client";
import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { IconRefresh } from '@tabler/icons-react';
import { Button } from '@/components/Button';

/** Refreshes the same authorized snapshot; no provider sync or write. */
export function HomeRetry({ label }: { label: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return <Button aria-label={label} title={label} disabled={pending} aria-busy={pending} onClick={() => startTransition(() => router.refresh())} leading={<IconRefresh size={18} aria-hidden="true" />} />;
}
