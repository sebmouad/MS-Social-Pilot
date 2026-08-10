import { redirect } from 'next/navigation';

import { NavBar } from '@/components/NavBar';
import { getAuthContext } from '@/lib/auth';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const auth = await getAuthContext();
  if (!auth) redirect('/login');

  return (
    <div className="min-h-screen">
      <NavBar
        userName={auth.user.name}
        workspaceName={auth.workspace.name}
        timezone={auth.workspace.timezone}
      />
      <main className="mx-auto max-w-7xl px-6 py-8">{children}</main>
    </div>
  );
}
