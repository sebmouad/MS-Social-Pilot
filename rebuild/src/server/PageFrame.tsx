import type { ReactNode } from 'react';
import { AppShell } from '@/components';
import type { ModuleId } from '@/lib/product';
import { requireViewer } from './context';

export async function PageFrame({ module, children, sidebar }: { module: ModuleId; children: ReactNode; sidebar?: ReactNode }) {
  const viewer = await requireViewer();
  return <AppShell activeModule={module} userName={viewer.user.name} workspaceName={viewer.membership.workspace.name} sidebar={sidebar}>{children}</AppShell>;
}
