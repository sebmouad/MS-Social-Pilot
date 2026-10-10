import { getTranslations } from 'next-intl/server';

import { HistoryClient } from '@/components/HistoryClient';
import { requirePage } from '@/lib/auth';
import { screenMetadata } from '@/lib/metadata';
import { canManageTeam } from '@/lib/constants';
import {
  countActivity,
  countEmailLog,
  countRecentEmailFailures,
  historyRetention,
  readActivity,
  readEmailLog,
} from '@/lib/history';
import { Pagination } from '@/components/Pagination';
import { pageHref, pageNumber, paginate } from '@/lib/paging';
import { formatInZone } from '@/lib/time';

export const dynamic = 'force-dynamic';

/** The tab says which screen and which client, so several open at once stay apart. */
export function generateMetadata() {
  return screenMetadata('history.title');
}


/**
 * What happened, and what was emailed about it.
 *
 * Owner and admin only. It names who did what, and for a deleted comment it
 * holds the only surviving copy of what was deleted — neither of which belongs
 * in front of everybody who can write a post.
 */
export default async function HistoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const auth = await requirePage();
  const t = await getTranslations('history');
  const params = await searchParams;
  const view = (Array.isArray(params.view) ? params.view[0] : params.view) === 'email'
    ? 'email'
    : 'activity';

  if (!canManageTeam(auth.role)) {
    return (
      <div className="space-y-6">
        <header>
          <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">{t('title')}</h1>
        </header>
        <p className="card p-8 text-center text-sm text-slate-600">{t('ownerOnly')}</p>
      </div>
    );
  }

  const timezone = auth.workspace.timezone;
  const retention = historyRetention();
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const workspaceId = auth.workspace.id;

  const page = paginate({
    total:
      view === 'email' ? await countEmailLog({ workspaceId }) : await countActivity(workspaceId),
    requested: pageNumber(params.page),
  });

  const [activity, emails, recentFailures] = await Promise.all([
    view === 'activity'
      ? readActivity({ workspaceId, skip: page.skip, limit: page.take })
      : Promise.resolve([]),
    view === 'email'
      ? readEmailLog({ workspaceId, skip: page.skip, limit: page.take })
      : Promise.resolve([]),
    countRecentEmailFailures({ workspaceId, since: weekAgo }),
  ]);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">{t('title')}</h1>
        <p className="mt-1 text-sm text-slate-600">{t('subtitle')}</p>
      </header>

      <HistoryClient
        view={view}
        recentFailures={recentFailures}
        retentionDays={view === 'email' ? retention.emailDays : retention.activityDays}
        activity={activity.map((row) => ({
          id: row.id,
          action: row.action,
          actorName: row.actorName,
          hadActor: row.actorName !== null || row.detail !== null,
          detail: row.detail ? summarise(row.detail) : null,
          whenLabel: formatInZone(row.createdAt, timezone),
        }))}
        emails={emails.map((row) => ({
          id: row.id,
          to: row.to,
          subject: row.subject,
          status: row.status,
          error: row.error,
          whenLabel: formatInZone(row.createdAt, timezone),
        }))}
      />

      <Pagination page={page} href={(next) => pageHref('/settings/history', params, next)} />
    </div>
  );
}

/**
 * The interesting parts of an entry's detail, as one short line.
 *
 * `detail` is free-form Json written by twenty-odd call sites, so this cannot
 * know the shape. It shows scalars and skips everything else rather than
 * printing a nested object at somebody — except that a deleted comment's text
 * is the whole point of the entry, so it is never dropped.
 */
function summarise(detail: Record<string, unknown>): string | null {
  const parts: string[] = [];

  for (const [key, value] of Object.entries(detail)) {
    if (value === null || value === undefined) continue;
    if (typeof value === 'object') continue;
    parts.push(`${key}: ${String(value)}`);
  }

  return parts.length > 0 ? parts.join(' · ') : null;
}
