'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useTransition } from 'react';
import { ErrorState, useErrorLocale } from '@/components/ErrorState';
import { reportBoundaryError } from '@/server/errors/ClientErrorReporter';

/**
 * Shown inside the layout when one page fails to render. It never prints or logs the error to the page: its message can carry internals.
 * The error is sent to the app's own recorder (Root › Errors). A server render failure is only retried by asking the server again,
 * so retry refreshes the route before resetting the boundary.
 */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  useEffect(() => { reportBoundaryError(error); }, [error]);
  return <ErrorState kind="error" locale={useErrorLocale()} onRetry={() => startTransition(() => { router.refresh(); reset(); })} />;
}
