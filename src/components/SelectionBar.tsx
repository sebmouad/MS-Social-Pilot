import type { AuthContext } from '@/lib/auth';
import type { Selection } from '@/lib/page-filter';

import { ProfileScope } from './ProfileScope';

/** The profile selection bar for a server-rendered screen. */
export function SelectionBar({ auth, selection }: { auth: AuthContext; selection: Selection }) {
  return (
    <ProfileScope
      workspaceId={auth.workspace.id}
      pages={selection.pages}
      groups={selection.groups}
      group={selection.group}
      ids={selection.ids}
      net={selection.net}
      networks={selection.networks}
    />
  );
}
