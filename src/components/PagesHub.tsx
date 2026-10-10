import Link from 'next/link';
import { TargetType } from '@prisma/client';
import { getTranslations } from 'next-intl/server';

import { FeedAvatar } from './FeedPost';
import { Icon, type IconName } from './Icon';
import { countComments } from '@/lib/engagement';
import { env } from '@/lib/env';
import { prisma } from '@/lib/prisma';
import { appLocale, formatInZone, relativeTime } from '@/lib/time';

/** Statuses a post waits in before it goes out. */
const WAITING = ['scheduled', 'publishing', 'pending_approval'] as const;

/**
 * Every Page and ad account in the workspace, on one screen — what Meta
 * Business Suite's home is for somebody running several: whose Page it is,
 * whether it can publish, what is going out next, and what is waiting for an
 * answer. Each card goes straight to the thing it reports: write for this
 * Page, read its messages, answer its comments, see its numbers.
 *
 * Built from rows already stored; it calls nothing on Facebook, so opening
 * the dashboard spends none of the app's call allowance.
 */
export async function PagesHub({
  workspaceId,
  timeZone,
  canConnect,
  now = new Date(),
}: {
  workspaceId: string;
  timeZone: string;
  canConnect: boolean;
  now?: Date;
}) {
  const t = await getTranslations('hub');

  const [pages, profiles, adAccounts] = await Promise.all([
    prisma.target.findMany({
      where: { workspaceId, type: TargetType.page },
      orderBy: { name: 'asc' },
      include: {
        socialAccount: { select: { name: true, invalidatedAt: true, tokenExpiresAt: true } },
      },
    }),
    prisma.socialAccount.count({ where: { workspaceId } }),
    env.adsEnabled
      ? prisma.adAccount.findMany({
          where: { workspaceId, enabled: true },
          orderBy: { name: 'asc' },
          include: { socialAccount: { select: { name: true } } },
        })
      : Promise.resolve([]),
  ]);

  const cards = await Promise.all(
    pages.map(async (page) => {
      const [waiting, next, last, unread, unanswered] = await Promise.all([
        prisma.postTarget.count({ where: { targetId: page.id, post: { status: { in: [...WAITING] } } } }),
        prisma.post.findFirst({
          where: { status: 'scheduled', scheduledAt: { gte: now }, targets: { some: { targetId: page.id } } },
          orderBy: { scheduledAt: 'asc' },
          select: { scheduledAt: true },
        }),
        prisma.postTarget.findFirst({
          where: { targetId: page.id, status: 'published' },
          orderBy: { publishedAt: 'desc' },
          select: { publishedAt: true },
        }),
        prisma.conversation.aggregate({ where: { targetId: page.id }, _sum: { unreadCount: true } }),
        countComments({ workspaceId, targetId: page.id, unanswered: true }),
      ]);
      return {
        page,
        waiting,
        next: next?.scheduledAt ?? null,
        last: last?.publishedAt ?? null,
        unread: unread._sum.unreadCount ?? 0,
        unanswered,
      };
    }),
  );

  const health = (page: (typeof pages)[number]): { tone: 'ok' | 'warn' | 'off'; label: string } => {
    if (!page.enabled) return { tone: 'off', label: t('paused') };
    if (page.socialAccount?.invalidatedAt) return { tone: 'warn', label: t('reconnect') };
    if (!page.canPublish) return { tone: 'warn', label: t('cannotPublish') };
    const expires = page.socialAccount?.tokenExpiresAt;
    if (expires && expires.getTime() - now.getTime() < env.tokenWarningDays * 86_400_000) {
      return { tone: 'warn', label: t('expiresSoon', { when: relativeTime(expires, now) }) };
    }
    return { tone: 'ok', label: t('ready') };
  };

  const tone = {
    ok: 'bg-emerald-50 text-emerald-700',
    warn: 'bg-amber-50 text-amber-800',
    off: 'bg-slate-100 text-slate-600',
  } as const;

  return (
    <section aria-labelledby="hub-title" className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3 px-1">
        <div>
          <h2 id="hub-title" className="text-[17px] font-bold text-slate-900">
            {t('title')}
          </h2>
          <p className="text-sm text-slate-600">
            {t('summary', { pages: pages.length, profiles, ads: adAccounts.length })}
          </p>
        </div>
        {canConnect && (
          <a href="/api/facebook/connect" className="btn-secondary">
            <Icon name="plus" size={16} />
            {t('connectProfile')}
          </a>
        )}
      </div>

      {pages.length === 0 ? (
        <div className="card flex flex-col items-center gap-2 px-6 py-10 text-center">
          <span aria-hidden className="flex h-14 w-14 items-center justify-center rounded-full bg-slate-100 text-slate-500">
            <Icon name="facebook" size={26} />
          </span>
          <p className="text-[17px] font-semibold text-slate-900">{t('noPages')}</p>
          <p className="max-w-md text-sm text-slate-600">{t('noPagesHint')}</p>
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {cards.map(({ page, waiting, next, last, unread, unanswered }) => {
            const state = health(page);
            const followers = page.followersCount ?? page.fanCount;
            const links: Array<{ href: string; icon: IconName; label: string; count?: number }> = [
              { href: `/compose?to=${page.id}`, icon: 'compose', label: t('write') },
              { href: `/analytics?view=inbox&target=${page.id}`, icon: 'inbox', label: t('inbox'), count: unread },
              {
                href: `/analytics?view=comments&target=${page.id}&shown=unanswered`,
                icon: 'comment',
                label: t('comments'),
                count: unanswered,
              },
              { href: `/analytics?target=${page.id}`, icon: 'analytics', label: t('insights') },
            ];
            return (
              <li key={page.id} className="card flex flex-col overflow-hidden">
                <div className="flex items-start gap-3 px-4 pt-4">
                  <FeedAvatar name={page.name} pictureUrl={page.pictureUrl} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[15px] font-semibold text-slate-900">{page.name}</p>
                    <p className="truncate text-[13px] text-slate-600">
                      {followers !== null ? t('followers', { count: followers }) : page.category ?? ''}
                    </p>
                    {page.socialAccount && (
                      <p className="truncate text-xs text-slate-500">{t('via', { profile: page.socialAccount.name })}</p>
                    )}
                  </div>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${tone[state.tone]}`}>
                    {state.label}
                  </span>
                </div>

                <dl className="mx-4 mt-3 grid grid-cols-2 gap-2 text-[13px]">
                  <div className="rounded-md bg-slate-50 px-2.5 py-2">
                    <dt className="text-slate-600">{t('nextPost')}</dt>
                    <dd className="truncate font-semibold text-slate-900">
                      {next ? formatInZone(next, timeZone, 'd MMM, HH:mm') : t('nothingPlanned')}
                    </dd>
                  </div>
                  <div className="rounded-md bg-slate-50 px-2.5 py-2">
                    <dt className="text-slate-600">{t('lastPost')}</dt>
                    <dd className="truncate font-semibold text-slate-900">
                      {last ? relativeTime(last, now) : '—'}
                    </dd>
                  </div>
                </dl>
                <p className="mx-4 mt-2 text-xs text-slate-500">
                  {t('waiting', { count: waiting })}
                </p>

                <nav
                  aria-label={t('actionsFor', { page: page.name })}
                  className="mt-3 grid grid-cols-4 border-t border-slate-200 px-1 py-1"
                >
                  {links.map((link) => (
                    <Link
                      key={link.href}
                      href={link.href}
                      className="relative flex flex-col items-center gap-0.5 rounded-md px-1 py-1.5 text-[12px] font-semibold text-slate-600 hover:bg-slate-100"
                    >
                      <Icon name={link.icon} size={18} />
                      <span className="truncate">{link.label}</span>
                      {link.count ? (
                        <span className="nums absolute right-2 top-0.5 min-w-[18px] rounded-full bg-rose-500 px-1 text-center text-[11px] font-bold leading-[18px] text-white">
                          {link.count > 99 ? '99+' : link.count.toLocaleString(appLocale())}
                        </span>
                      ) : null}
                    </Link>
                  ))}
                </nav>
              </li>
            );
          })}
        </ul>
      )}

      {adAccounts.length > 0 && (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label={t('adAccounts')}>
          {adAccounts.map((account) => (
            <li key={account.id}>
              <Link
                href={`/ads?account=${account.id}`}
                className="card flex items-center gap-3 px-4 py-3 hover:bg-slate-50"
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-600">
                  <Icon name="megaphone" size={18} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-semibold text-slate-900">{account.name}</span>
                  <span className="block truncate text-xs text-slate-500">
                    {[account.currency, account.socialAccount ? t('via', { profile: account.socialAccount.name }) : null]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </span>
                <Icon name="chevronRight" size={16} className="text-slate-400" />
              </Link>
            </li>
          ))}
        </ul>
      )}

      {/* Said where somebody looks for them, rather than leaving a gap. */}
      <p className="flex items-center gap-1.5 px-1 text-xs text-slate-500">
        <Icon name="group" size={14} />
        {t('groupsNote')}
      </p>
    </section>
  );
}
