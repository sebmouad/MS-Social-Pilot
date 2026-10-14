import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { AppShell } from '@/components/AppShell';
import { ConfirmProvider } from '@/components/ConfirmProvider';
import { ErrorReporter } from '@/components/ErrorReporter';
import { accessRefusal, getAuthContext } from '@/lib/auth';
import { canApprove, canCompose } from '@/lib/constants';
import { pendingApprovalCount } from '@/lib/approvals';
import { brand } from '@/lib/operator';
import { ensureSettings } from '@/lib/settings';
import { mayUseDeveloperFeatures } from '@/lib/modules';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const auth = await getAuthContext();
  if (!auth) redirect('/login');
  if (!auth.user.emailVerified) redirect('/verify-email');
  await ensureSettings();

  // Root's switches: a module switched off is not there; a suspended workspace
  // shows why instead of the screen.
  const refusal = await accessRefusal(auth);
  if (refusal === 'module') notFound();
  const t = await getTranslations('suspended');

  const showApprovals = canApprove(auth.role) && auth.workspace.requiresApproval && auth.modules.includes('schedule');
  const pendingApprovals = showApprovals && !refusal ? await pendingApprovalCount(auth.workspace.id, auth.pageScope) : 0;

  return (
    <ConfirmProvider>
    <ErrorReporter />
    <AppShell
        userName={auth.user.name}
        workspaceId={auth.workspace.id}
        workspaceName={auth.workspace.name}
        timezone={auth.workspace.timezone}
        showApprovals={showApprovals}
        pendingApprovals={pendingApprovals}
        isRoot={auth.isInstanceOwner}
        developerFeatures={mayUseDeveloperFeatures(auth)}
        canWrite={canCompose(auth.role)}
        rootVisit={auth.rootVisit}
        modules={refusal === 'suspended' ? [] : auth.modules}
        features={refusal === 'suspended' ? [] : auth.features}
        role={auth.role}
        clientAccess={auth.workspace.clientAccess}
        brand={brand()}
        workspaces={auth.workspaces.map((workspace) => ({
          id: workspace.id,
          name: workspace.name,
          role: workspace.role,
        }))}
    >
      {refusal === 'suspended' ? (
        <div className="card mx-auto mt-10 max-w-lg space-y-2 p-6 text-center" role="alert">
          <h1 className="text-xl font-semibold text-slate-900">{t('title')}</h1>
          <p className="text-sm text-slate-600">{t('body')}</p>
        </div>
      ) : (
        children
      )}
    </AppShell>
    </ConfirmProvider>
  );
}
