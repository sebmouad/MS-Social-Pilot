import { notFound, redirect } from 'next/navigation';

import { getAuthContext } from '@/lib/auth';
import { screenMetadata } from '@/lib/metadata';

export const dynamic = 'force-dynamic';

export function generateMetadata() {
  return screenMetadata('config.title');
}

/**
 * Configuration moved to the root section; old links still work for root.
 * Outside the app layout on purpose, so everybody else gets a real 404
 * rather than a not-found message inside a page that answered 200.
 */
export default async function ConfigPage() {
  const auth = await getAuthContext();
  if (!auth?.isInstanceOwner) notFound();
  redirect('/root/config');
}
