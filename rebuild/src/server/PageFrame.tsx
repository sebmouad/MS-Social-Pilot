import type { ReactNode } from 'react';
import { AppShell } from '@/components';
import type { ModuleId } from '@/lib/product';
import { requireViewer } from './context';

export async function PageFrame({ module, children }: { module: ModuleId; children: ReactNode }) {
  const viewer = await requireViewer();
  return <AppShell activeModule={module} userName={viewer.user.name} workspaceName={viewer.membership.workspace.name}>{children}</AppShell>;
}
