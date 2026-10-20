import type { Metadata } from 'next';
import { OperationError } from '@/lib/operation-error';
import { PageFrame } from '@/server/PageFrame';
import { requireViewer } from '@/server/context';
import { getTeamDirectory } from '@/modules/settings/server/team';
import { SettingsPage, SettingsPanel, styles } from '@/modules/settings/ui/_components';
import { settingsLocale } from '@/modules/settings/ui/locale';
import { fill } from '@/modules/settings/ui/shell-copy';
import { TeamControls } from './TeamControls';
import { listTeamInvitations } from '@/modules/settings/server/invitations';
import { InvitationControls } from './InvitationControls';
import { teamCopy } from './copy';

export const metadata: Metadata = { title: 'Team' };

export default async function TeamPage() {
  const viewer = await requireViewer({ feature: 'settings/team' });
  const locale = await settingsLocale();
  const t = teamCopy[locale];
  let directory: Awaited<ReturnType<typeof getTeamDirectory>> | null = null;
  let directoryError: string | null = null;
  let invitations: Awaited<ReturnType<typeof listTeamInvitations>> | null = null;
  let invitationError: string | null = null;
  try {
    directory = await getTeamDirectory({ userId: viewer.user.id, workspaceId: viewer.workspaceId });
  } catch (error) {
    directoryError = error instanceof OperationError
      ? error.message
      : t.directoryFailed;
  }
  try { invitations = await listTeamInvitations({ userId: viewer.user.id, workspaceId: viewer.workspaceId }); }
  catch (error) { invitationError = error instanceof OperationError ? error.message : t.invitationsFailed; }

  return <PageFrame module="settings"><SettingsPage active="settings/team" title={t.title} locale={locale} description={fill(t.description, { workspace: viewer.membership.workspace.name })}>
    <SettingsPanel title={t.membersPanel} detail={directory ? directory.total === 1 ? t.memberOne : fill(t.memberMany, { count: directory.total }) : t.memberFallback}>
      {directoryError ? <div className={styles['settings-empty']} role="alert"><p>{directoryError}</p><a href="/settings/team">{t.refreshDirectory}</a></div> : directory && <TeamControls key={viewer.workspaceId} locale={locale} members={directory.members} targets={directory.targets} actorId={directory.actorId} actorRole={directory.actorRole} total={directory.total} hasMore={directory.hasMore} defaultRole={directory.defaults.role} defaultAllPages={directory.defaults.allPages} />}
    </SettingsPanel>
    {invitations && (invitations.available || invitations.invitations.length > 0) && <SettingsPanel title={t.invitationsPanel} detail={t.invitationsDetail}>
      <InvitationControls key={viewer.workspaceId} locale={locale} invitations={invitations.invitations.map(item => ({ ...item, expiresAt: item.expiresAt.toISOString(), acceptedAt: item.acceptedAt?.toISOString() ?? null, createdAt: item.createdAt.toISOString() }))} actorRole={viewer.membership.role} available={invitations.available} />
    </SettingsPanel>}
    {invitationError && <p role="alert" className={styles['settings-note']}>{invitationError}</p>}
    <p className={styles['settings-note']}>{t.footnote}</p>
  </SettingsPage></PageFrame>;
}
