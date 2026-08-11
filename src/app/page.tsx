import { redirect } from 'next/navigation';

import { getAuthContext } from '@/lib/auth';
import { isFirstRun } from '@/lib/setup';

export default async function HomePage() {
  const auth = await getAuthContext();
  if (auth) redirect('/dashboard');

  // A server nobody has used yet answered with a sign-in form for an account
  // that does not exist. Send whoever just deployed it somewhere useful.
  if (await isFirstRun()) redirect('/setup');

  redirect('/login');
}
