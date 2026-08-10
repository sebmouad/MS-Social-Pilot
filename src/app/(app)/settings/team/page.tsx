import { getTranslations } from 'next-intl/server';

import { SettingsNav } from '@/components/SettingsNav';

import { TeamClient } from '@/components/TeamClient';
import { requireAuth } from '@/lib/auth';
import { canManageTeam } from '@/lib/constants';
import { prisma } from '@/lib/prisma';
import { emailEnabled } from '@/lib/email/send';
import { formatInZone } from '@/lib/time';

export const dynamic = 'force-dynamic';

export default async function TeamPage() {
  const auth = await requireAuth();
  const t = await getTranslations('team');
  const timezone = auth.workspace.timezone;

  const [members, invitations] = await Promise.all([
    prisma.membership.findMany({
      where: { workspaceId: auth.workspace.id },
      include: { user: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.invitation.findMany({
      where: { workspaceId: auth.workspace.id, acceptedAt: null },
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-slate-900">{t('title')}</h1>
        <p className="mt-1 text-sm text-slate-600">{t('subtitle')}</p>
      </header>

      <SettingsNav />

      <TeamClient
        canManage={canManageTeam(auth.role)}
        emailConfigured={emailEnabled()}
        members={members.map((membership) => ({
          userId: membership.user.id,
          name: membership.user.name,
          email: membership.user.email,
          role: membership.role,
          isSelf: membership.user.id === auth.user.id,
        }))}
        invitations={invitations.map((invitation) => ({
          id: invitation.id,
          email: invitation.email,
          role: invitation.role,
          expiresLabel: formatInZone(invitation.expiresAt, timezone, 'd MMM yyyy'),
        }))}
      />
    </div>
  );
}
