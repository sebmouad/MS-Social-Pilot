import type { Metadata } from 'next';
import { authLocale } from '@/modules/home/auth/locale';
import { SignInForm } from './sign-in-form';

export const metadata: Metadata = { title: 'Sign in' };
export const dynamic = 'force-dynamic';

export default async function SignIn() {
  return <SignInForm locale={await authLocale()} />;
}
