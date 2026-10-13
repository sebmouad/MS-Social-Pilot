import type { ReactNode } from 'react';

import type { AuthContext } from '@/lib/auth';
import { canManageOthersPosts, canManageSettings } from '@/lib/constants';
import type { PageFilter } from '@/lib/page-filter';

import { PagesSidebar } from './PagesSidebar';
import { SidebarDock } from './SidebarDock';

/**
 * A screen with the channel column on its left: the one way to choose which
 * channels every screen shows (the shared selection).
 */
export function ChannelsLayout({ auth, selection, tools, children }: { auth: AuthContext; selection: PageFilter; tools?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-6 lg:flex-row">
      <SidebarDock>
      <PagesSidebar
        workspaceId={auth.workspace.id}
        pages={selection.pages}
        groups={selection.groups}
        group={selection.group}
        visible={selection.visible}
        platform={selection.platform}
        canManageGroups={canManageSettings(auth.role)}
        canManageQueue={canManageOthersPosts(auth.role)}
        tools={tools}
      />
      </SidebarDock>
      {children}
    </div>
  );
}
