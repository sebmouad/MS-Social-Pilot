import { getTranslations } from 'next-intl/server';


import { ClientAccess } from '@/components/ClientAccess';
import { TeamClient } from '@/components/TeamClient';
import { requirePage } from '@/lib/auth';
import { screenMetadata } from '@/lib/metadata';
import { canManageSettings, canManageTeam } from '@/lib/constants';
import { prisma } from '@/lib/prisma';
import { listPageGroups } from '@/lib/page-groups';
import { ALL_PAGES } from '@/lib/page-access';
import { emailEnabled } from '@/lib/email/send';
import { formatInZone } from '@/lib/time';

export const dynamic = 'force-dynamic';

/** The tab says which screen and which client, so several open at once stay apart. */
export function generateMetadata() {
  return screenMetadata('team.title');
}


export default async function TeamPage() {
  const auth = await requirePage();
  const t = await getTranslations('team');
  const timezone = auth.workspace.timezone;

  const [members, invitations, pages, groups] = await Promise.all([
    prisma.membership.findMany({
      where: { workspaceId: auth.workspace.id },
      include: { user: { select: { id: true, name: true, email: true } }, pages: { select: { targetId: true } } },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.invitation.findMany({
      where: { workspaceId: auth.workspace.id, acceptedAt: null },
      orderBy: { createdAt: 'desc' },
    }),
    // Only an admin sets limits, and admins see every Page.
    canManageTeam(auth.role)
      ? prisma.target.findMany({
          where: { workspaceId: auth.workspace.id, type: { not: 'group' } },
          select: { id: true, name: true, pictureUrl: true },
          orderBy: { name: 'asc' },
        })
      : Promise.resolve([]),
    canManageTeam(auth.role) ? listPageGroups(auth.workspace.id, ALL_PAGES) : Promise.resolve([]),
  ]);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-slate-900">{t('title')}</h1>
        <p className="mt-1 text-sm text-slate-600">{t('subtitle')}</p>
      </header>

      <TeamClient
        canManage={canManageTeam(auth.role)}
        viewerRole={auth.role}
        emailConfigured={emailEnabled()}
        members={members.map((membership) => ({
          userId: membership.user.id,
          name: membership.user.name,
          email: membership.user.email,
          role: membership.role,
          isSelf: membership.user.id === auth.user.id,
          allPages: membership.allPages,
          pageIds: membership.pages.map((row) => row.targetId),
        }))}
        pages={pages}
        groups={groups}
        invitations={invitations.map((invitation) => ({
          id: invitation.id,
          email: invitation.email,
          role: invitation.role,
          expiresLabel: formatInZone(invitation.expiresAt, timezone, 'd MMM yyyy'),
        }))}
      />

      {canManageSettings(auth.role) && <ClientAccess initial={auth.workspace.clientAccess} />}

      {/* Who can do what, in one line each — the question asked before every invite. */}
      <section className="card p-5" aria-labelledby="roles-title">
        <h2 id="roles-title" className="mb-3 text-[15px] font-semibold text-slate-900">
          {t('rolesTitle')}
        </h2>
        <dl className="grid gap-3 sm:grid-cols-2">
          {(['owner', 'admin', 'editor', 'contributor', 'viewer', 'client'] as const).map((role) => (
            <div key={role} className="rounded-lg bg-slate-50 px-3 py-2.5">
              <dt className="text-sm font-semibold text-slate-900">{t(`roles.${role}`)}</dt>
              <dd className="text-xs text-slate-600">{t(`roleHints.${role}`)}</dd>
              <dd className="mt-1 text-[11px] text-slate-500">{t(`roleExtra.${role}`)}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
