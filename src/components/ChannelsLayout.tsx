import type { ReactNode } from 'react';

import type { AuthContext } from '@/lib/auth';
import { canManageOthersPosts, canManageSettings } from '@/lib/constants';
import type { PageFilter } from '@/lib/page-filter';

import { PagesSidebar } from './PagesSidebar';

/**
 * A screen with the channel column on its left: the one way to choose which
 * channels every screen shows (the shared selection, NEXT_PHASES Phase A).
 */
export function ChannelsLayout({ auth, selection, children }: { auth: AuthContext; selection: PageFilter; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-6 lg:flex-row">
      <PagesSidebar
        workspaceId={auth.workspace.id}
        pages={selection.pages}
        groups={selection.groups}
        group={selection.group}
        visible={selection.visible}
        net={selection.net}
        networks={selection.networks}
        canManageGroups={canManageSettings(auth.role)}
        canManageQueue={canManageOthersPosts(auth.role)}
      />
      {children}
    </div>
  );
}
