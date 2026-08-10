import { redirect } from 'next/navigation';

import { AuthForm } from '@/components/AuthForm';
import { getAuthContext } from '@/lib/auth';

export default async function LoginPage() {
  if (await getAuthContext()) redirect('/dashboard');
  return <AuthForm mode="login" />;
}
