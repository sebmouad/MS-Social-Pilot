import type { Metadata } from 'next';
import { PageFrame } from '@/server/PageFrame';
import { requireViewer } from '@/server/context';
import { prisma } from '@/server/data';
import { SettingsPage, SettingsPanel, styles } from '../_components';

export const metadata: Metadata = { title: 'Team' };

export default async function TeamPage() {
  const viewer = await requireViewer({ feature: 'settings/team' });
  const canViewTeam = viewer.membership.role === 'owner' || viewer.membership.role === 'admin';
  if (!canViewTeam) return <PageFrame module="settings"><SettingsPage active="settings/team" title="Team" description="Workspace members and roles."><SettingsPanel title="Team access"><p className={styles['settings-note']}>Only workspace owners and admins can view the member directory.</p></SettingsPanel></SettingsPage></PageFrame>;
  const members = await prisma.membership.findMany({
    where: { workspaceId: viewer.workspaceId },
    orderBy: [{ role: 'asc' }, { user: { name: 'asc' } }],
    select: { role: true, user: { select: { name: true, email: true } } },
  });

  return <PageFrame module="settings"><SettingsPage active="settings/team" title="Team" description={`People with access to ${viewer.membership.workspace.name}.`}>
    <SettingsPanel title="Workspace members" detail={`${members.length} member${members.length === 1 ? '' : 's'} currently have access`}>
      {members.length ? <div className={styles['settings-table-wrap']}><table className={styles['settings-table']}><thead><tr><th scope="col">Person</th><th scope="col">Email</th><th scope="col">Role</th></tr></thead><tbody>
        {members.map(member => <tr key={member.user.email}><td><span className={styles['settings-table__primary']}>{member.user.name}</span></td><td>{member.user.email}</td><td><span className={styles['settings-chip']}>{member.role}</span></td></tr>)}
      </tbody></table></div> : <div className={styles['settings-empty']}>No workspace memberships are recorded.</div>}
    </SettingsPanel>
    <p className={styles['settings-note']}>This view shows current membership records. Team access changes are not available here.</p>
  </SettingsPage></PageFrame>;
}
