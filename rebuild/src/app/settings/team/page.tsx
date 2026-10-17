import { entitledPlatformIds } from '@/server/entitlements';
import type { Metadata } from 'next';
import { enabledSocialAccountWhere } from '@/server/platforms/registry';
import { PageFrame } from '@/server/PageFrame';
import { requireViewer } from '@/server/context';
import { prisma } from '@/server/data';
import { SettingsPage, SettingsPanel, styles } from '../_components';
import { TeamControls } from './TeamControls';

export const metadata: Metadata = { title: 'Team' };

export default async function TeamPage() {
  const viewer = await requireViewer({ feature: 'settings/team' });
  const canViewTeam = viewer.membership.role === 'owner' || viewer.membership.role === 'admin';
  if (!canViewTeam) return <PageFrame module="settings"><SettingsPage active="settings/team" title="Team" description="Workspace members and roles."><SettingsPanel title="Team access"><p className={styles['settings-note']}>Only workspace owners and admins can view the member directory.</p></SettingsPanel></SettingsPage></PageFrame>;
  const [members, targets] = await Promise.all([
    prisma.$queryRaw<Array<{ id: string; userId: string; role: string; name: string; email: string; allPages: boolean; targetIds: string[] }>>`
      SELECT m.id, m."userId", m.role::text AS role, u.name, u.email, COALESCE(m."allPages", false) AS "allPages",
        COALESCE(ARRAY_AGG(DISTINCT access."targetId") FILTER (WHERE access."targetId" IS NOT NULL), ARRAY[]::text[]) AS "targetIds"
      FROM memberships m JOIN users u ON u.id = m."userId"
      LEFT JOIN member_page_access access ON access."membershipId" = m.id
      WHERE m."workspaceId" = ${viewer.workspaceId}
      GROUP BY m.id, u.name, u.email ORDER BY m.role, u.name
    `,
    prisma.target.findMany({ where: { workspaceId: viewer.workspaceId, enabled: true, socialAccount: { is: await enabledSocialAccountWhere(entitledPlatformIds(viewer.entitlements)) } }, orderBy: [{ type: 'asc' }, { name: 'asc' }], select: { id: true, name: true, type: true } }),
  ]);

  return <PageFrame module="settings"><SettingsPage active="settings/team" title="Team" description={`People with access to ${viewer.membership.workspace.name}.`}>
    <SettingsPanel title="Workspace members" detail={`${members.length} member${members.length === 1 ? '' : 's'} currently have access`}>
      {members.length ? <TeamControls members={members} targets={targets} actorId={viewer.user.id} actorRole={viewer.membership.role} /> : <div className={styles['settings-empty']}>No workspace memberships are recorded.</div>}
    </SettingsPanel>
    <p className={styles['settings-note']}>Changes apply immediately. Removing someone revokes their access to this workspace while keeping their account and access to other workspaces.</p>
  </SettingsPage></PageFrame>;
}
