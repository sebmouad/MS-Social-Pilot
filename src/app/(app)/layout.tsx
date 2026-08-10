import { redirect } from 'next/navigation';

import { NavBar } from '@/components/NavBar';
import { getAuthContext } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { canApprove } from '@/lib/constants';
import { ApprovalStatus } from '@prisma/client';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const auth = await getAuthContext();
  if (!auth) redirect('/login');

  const showApprovals = canApprove(auth.role) && auth.workspace.requiresApproval;
  const pendingApprovals = showApprovals
    ? await prisma.post.count({
        where: { workspaceId: auth.workspace.id, approvalStatus: ApprovalStatus.pending },
      })
    : 0;

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
      <main className="mx-auto max-w-7xl px-6 py-8">{children}</main>
    </div>
  );
}
