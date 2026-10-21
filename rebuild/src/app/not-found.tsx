'use client';
import { ErrorState, useErrorLocale } from '@/components/ErrorState';

/** Themed, bilingual page for unknown routes and `notFound()` calls; Next answers it with a real 404 status. */
export default function NotFound() {
  return <ErrorState kind="not-found" locale={useErrorLocale()} />;
}
