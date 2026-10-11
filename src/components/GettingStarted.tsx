import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { prisma } from '@/lib/prisma';
import { DismissibleCard } from './DismissibleCard';
import { Icon, type IconName } from './Icon';

const STEPS: Array<{ id: string; href: string; icon: IconName }> = [
  { id: 'connect', href: '/connections', icon: 'link' },
  { id: 'post', href: '/compose', icon: 'plus' },
  { id: 'queue', href: '/queue', icon: 'clock' },
  { id: 'team', href: '/settings/team', icon: 'team' },
  { id: 'client', href: '/settings/sharing', icon: 'approvals' },
  { id: 'claude', href: '/settings/api', icon: 'code' },
];

/**
 * "Getting started, 3 of 6": the few things that make the app worth having,
 * ticked off from what the workspace has actually done. It goes away once
 * everything is done, or when someone closes it.
 */
export async function GettingStarted({ workspaceId }: { workspaceId: string }) {
  const t = await getTranslations('dashboard');
  const [pages, posts, slots, members, links, reports, keys] = await Promise.all([
    prisma.target.count({ where: { workspaceId } }),
    prisma.post.count({ where: { workspaceId } }),
    prisma.queueSlot.count({ where: { workspaceId } }),
    prisma.membership.count({ where: { workspaceId } }),
    prisma.shareLink.count({ where: { workspaceId, revokedAt: null } }),
    prisma.reportSchedule.count({ where: { workspaceId } }),
    prisma.apiToken.count({ where: { workspaceId, revokedAt: null } }),
  ]);
  const done: Record<string, boolean> = {
    connect: pages > 0,
    post: posts > 0,
    queue: slots > 0,
    team: members > 1,
    client: links + reports > 0,
    claude: keys > 0,
  };
  const count = STEPS.filter((step) => done[step.id]).length;
  if (count === STEPS.length) return null;
  const next = STEPS.find((step) => !done[step.id])!;

  return (
    <DismissibleCard storageKey={`msp-getting-started-${workspaceId}`} closeLabel={t('gsHide')}>
      <div className="flex flex-wrap items-center gap-4 border-b border-slate-100 px-5 py-4">
        <div className="relative h-12 w-12 shrink-0" aria-hidden>
          <svg viewBox="0 0 36 36" className="h-12 w-12 -rotate-90">
            <circle cx="18" cy="18" r="15.5" fill="none" stroke="#e4e6eb" strokeWidth="4" />
            <circle
              cx="18"
              cy="18"
              r="15.5"
              fill="none"
              stroke="#1877f2"
              strokeWidth="4"
              strokeLinecap="round"
              strokeDasharray={`${(count / STEPS.length) * 97.4} 97.4`}
            />
          </svg>
          <span className="nums absolute inset-0 flex items-center justify-center text-xs font-bold text-slate-900">
            {count}/{STEPS.length}
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-[17px] font-bold text-slate-900">{t('gsTitle')}</h2>
          <p className="text-sm text-slate-600">{t('gsNext', { step: t(`gs_${next.id}`) })}</p>
        </div>
      </div>
      <ol className="grid gap-px bg-slate-100 sm:grid-cols-2 lg:grid-cols-3">
        {STEPS.map((step) => (
          <li key={step.id} className="bg-white">
            <Link
              href={step.href}
              className={`flex h-full items-start gap-3 px-5 py-3.5 transition-colors hover:bg-slate-50 ${done[step.id] ? 'opacity-60' : ''}`}
            >
              <span
                className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
                  done[step.id] ? 'bg-emerald-500 text-white' : 'bg-brand-50 text-brand-600'
                }`}
              >
                <Icon name={done[step.id] ? 'check' : step.icon} size={15} />
              </span>
              <span className="min-w-0">
                <span className={`block text-sm font-semibold text-slate-900 ${done[step.id] ? 'line-through decoration-slate-400' : ''}`}>
                  {t(`gs_${step.id}`)}
                </span>
                <span className="block text-xs text-slate-500">{t(`gsHint_${step.id}`)}</span>
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </DismissibleCard>
  );
}
