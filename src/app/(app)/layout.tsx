import { redirect } from 'next/navigation';

import { NavBar } from '@/components/NavBar';
import { getAuthContext } from '@/lib/auth';
import { canApprove } from '@/lib/constants';
import { pendingApprovalCount } from '@/lib/approvals';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const auth = await getAuthContext();
  if (!auth) redirect('/login');

  const showApprovals = canApprove(auth.role) && auth.workspace.requiresApproval;
  const pendingApprovals = showApprovals ? await pendingApprovalCount(auth.workspace.id) : 0;

  return (
    <div className="min-h-screen">
      <NavBar
        userName={auth.user.name}
        workspaceId={auth.workspace.id}
        workspaceName={auth.workspace.name}
        timezone={auth.workspace.timezone}
        showApprovals={showApprovals}
        pendingApprovals={pendingApprovals}
        workspaces={auth.workspaces.map((workspace) => ({
          id: workspace.id,
          name: workspace.name,
          role: workspace.role,
        }))}
      />
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">{children}</main>
    </div>
  );
}
