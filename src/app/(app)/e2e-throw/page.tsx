import { notFound } from 'next/navigation';

import { env } from '@/lib/env';

/**
 * A page that throws, so the error boundary can be tested.
 *
 * Error handling that has never been exercised is the kind that fails when it
 * is needed, and there is no other way to make a server component throw on
 * demand. It exists only where `E2E_ALLOW_THROW` is set — the browser walk
 * sets it, nothing else does, and without it this route is a 404 like any
 * other address nobody defined.
 *
 * Not named with a leading underscore, tempting as that is: Next treats such a
 * folder as private and excludes it from routing entirely, so the route would
 * not exist even with the flag set.
 */
export const dynamic = 'force-dynamic';

export default async function ThrowPage() {
  if (process.env.E2E_ALLOW_THROW !== 'true') notFound();

  // Referenced so the module cannot be tree-shaken to nothing in a build where
  // the guard above is statically false.
  void env.appUrl;

  throw new Error('Deliberate failure, for the error boundary walk.');
}
