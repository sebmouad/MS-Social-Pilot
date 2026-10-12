import { getTranslations } from 'next-intl/server';

import { PlansClient } from '@/components/PlansClient';
import { requireRoot } from '@/lib/auth';
import { screenMetadata } from '@/lib/metadata';
import { listSubscribers } from '@/lib/plans';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export function generateMetadata() {
  return screenMetadata('root.plans.title');
}

/** Plans and who is on which: every value here is root's to change. */
export default async function RootPlansPage() {
  await requireRoot();
  const t = await getTranslations('root.plans');
  const [plans, subscribers] = await Promise.all([prisma.plan.findMany({ orderBy: { position: 'asc' } }), listSubscribers()]);
  const finite = (value: number) => (Number.isFinite(value) ? value : null);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">{t('title')}</h1>
        <p className="mt-1 text-sm text-slate-600">{t('subtitle')}</p>
      </header>
      <PlansClient
        plans={plans.map(({ createdAt: _c, updatedAt: _u, ...plan }) => plan)}
        subscribers={subscribers.map((user) => ({
          id: user.id,
          name: user.name,
          email: user.email,
          root: user.isInstanceOwner,
          planId: user.planId,
          extraChannels: user.extraChannels,
          usage: user.usage,
          limits: {
            channels: finite(user.plan && !user.isInstanceOwner && user.plan.channels !== null ? user.plan.channels + user.extraChannels : Infinity),
            members: user.isInstanceOwner ? null : (user.plan?.members ?? null),
            workspaces: user.isInstanceOwner ? null : (user.plan?.workspaces ?? null),
          },
        }))}
      />
    </div>
  );
}
