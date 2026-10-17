'use client';

import { rootUserConfirmation } from '@/lib/root-user-controls';
import { workspaceAccessConfirmation } from '@/lib/root-workspace-access';
import { ConfirmAction } from '../plans/ConfirmAction';

export function EnableUser({ id, email }: { id: string; email: string }) {
  return <ConfirmAction id={`enable-${id}`} label="Enable" title={`Enable ${email}?`} description="This account will be allowed to sign in again." phrase={rootUserConfirmation('enable', email)} endpoint={`/api/root/lifecycle/users/${encodeURIComponent(id)}`} method="PATCH" body={{ disabled: false }} variant="primary" successText="Account enabled." />;
}

export function RestoreWorkspace({ id, name, blocked }: { id: string; name: string; blocked: boolean }) {
  return <ConfirmAction id={`restore-${id}`} label="Restore" title={`Restore ${name}?`} description="Members regain access and new app operations resume." phrase={workspaceAccessConfirmation(id, false)} endpoint={`/api/root/lifecycle/workspaces/${encodeURIComponent(id)}`} method="PATCH" body={{ suspended: false }} variant="primary" successText="Workspace restored." disabled={blocked} />;
}
