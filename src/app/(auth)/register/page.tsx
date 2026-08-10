import { redirect } from 'next/navigation';

import { AuthForm } from '@/components/AuthForm';
import { getAuthContext } from '@/lib/auth';

export default async function RegisterPage() {
  if (await getAuthContext()) redirect('/dashboard');
  return <AuthForm mode="register" />;
}
