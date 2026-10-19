import type { Metadata } from 'next';
import { OperationError } from '@/lib/operation-error';
import { PageFrame } from '@/server/PageFrame';
import { requireViewer } from '@/server/context';
import { getTeamDirectory } from '@/modules/settings/server/team';
import { SettingsPage, SettingsPanel, styles } from '@/modules/settings/ui/_components';
import { TeamControls } from './TeamControls';
import { listTeamInvitations } from '@/modules/settings/server/invitations';
import { InvitationControls } from './InvitationControls';

export const metadata: Metadata = { title: 'Team' };

export default async function TeamPage() {
  const viewer = await requireViewer({ feature: 'settings/team' });
  let directory: Awaited<ReturnType<typeof getTeamDirectory>> | null = null;
  let directoryError: string | null = null;
  let invitations: Awaited<ReturnType<typeof listTeamInvitations>> | null = null;
  let invitationError: string | null = null;
  try {
    directory = await getTeamDirectory({ userId: viewer.user.id, workspaceId: viewer.workspaceId });
  } catch (error) {
    directoryError = error instanceof OperationError
      ? error.message
      : 'The member directory could not be loaded. Refresh the page or try again later.';
  }
  try { invitations = await listTeamInvitations({ userId: viewer.user.id, workspaceId: viewer.workspaceId }); }
  catch (error) { invitationError = error instanceof OperationError ? error.message : 'Invitations could not be loaded. Refresh the page to try again.'; }

  return <PageFrame module="settings"><SettingsPage active="settings/team" title="Team" description={`People with access to ${viewer.membership.workspace.name}.`}>
    <SettingsPanel title="Workspace members" detail={directory ? directory.total === 1 ? '1 member currently has access' : `${directory.total} members currently have access` : 'Member access and channel scope'}>
      {directoryError ? <div className={styles['settings-empty']} role="alert"><p>{directoryError}</p><a href="/settings/team">Refresh member directory</a></div> : directory && <TeamControls key={viewer.workspaceId} members={directory.members} targets={directory.targets} actorId={directory.actorId} actorRole={directory.actorRole} total={directory.total} hasMore={directory.hasMore} defaultRole={directory.defaults.role} defaultAllPages={directory.defaults.allPages} />}
    </SettingsPanel>
    {invitations && (invitations.available || invitations.invitations.length > 0) && <SettingsPanel title="Invitations" detail="Invite people to join this workspace">
      <InvitationControls key={viewer.workspaceId} invitations={invitations.invitations.map(item => ({ ...item, expiresAt: item.expiresAt.toISOString(), acceptedAt: item.acceptedAt?.toISOString() ?? null, createdAt: item.createdAt.toISOString() }))} actorRole={viewer.membership.role} available={invitations.available} />
    </SettingsPanel>}
    {invitationError && <p role="alert" className={styles['settings-note']}>{invitationError}</p>}
    <p className={styles['settings-note']}>Changes apply immediately. Removing someone revokes access to this workspace while keeping their account and access to other workspaces.</p>
  </SettingsPage></PageFrame>;
}
