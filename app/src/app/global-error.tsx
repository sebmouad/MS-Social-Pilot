'use client';
import { GlobalErrorState } from '@/components/ErrorState';

/** Last resort when the root layout itself fails (for example the database is unreachable). */
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <GlobalErrorState reset={reset} />;
}
