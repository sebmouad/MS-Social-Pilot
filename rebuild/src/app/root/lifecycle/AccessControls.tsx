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

export function DeleteWorkspace({ id, name, blocked }: { id: string; name: string; blocked: boolean }) {
  return <ConfirmAction id={`delete-${id}`} label="Delete" title={`Permanently delete ${name}?`} description="Every post, inbox item, analytics record, setting, member and stored file of this workspace is erased. Accounts stay. Content already published on social platforms is not removed. This cannot be undone; make sure a recent backup exists." phrase={`DELETE WORKSPACE ${id}`} endpoint={`/api/root/lifecycle/workspaces/${encodeURIComponent(id)}`} method="DELETE" body={{}} variant="danger" successText="Workspace deleted." disabled={blocked} />;
}

export function DeleteUser({ id, email }: { id: string; email: string }) {
  return <ConfirmAction id={`delete-user-${id}`} label="Delete" title={`Permanently delete ${email}?`} description="The account, its sessions and personal settings are erased. Its posts and invitations stay with their workspaces and are credited to you; API keys it created are revoked. An account that is the only owner of a workspace cannot be deleted. This cannot be undone." phrase={`DELETE ACCOUNT ${email}`} endpoint={`/api/root/lifecycle/users/${encodeURIComponent(id)}`} method="DELETE" body={{}} variant="danger" successText="Account deleted." />;
}
