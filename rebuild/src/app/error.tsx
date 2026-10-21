'use client';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { ErrorState, useErrorLocale } from '@/components/ErrorState';

/**
 * Shown inside the layout when one page fails to render. It never prints or logs the error: its message can carry internals.
 * A server render failure is only retried by asking the server again, so retry refreshes the route before resetting the boundary.
 */
export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  return <ErrorState kind="error" locale={useErrorLocale()} onRetry={() => startTransition(() => { router.refresh(); reset(); })} />;
}
