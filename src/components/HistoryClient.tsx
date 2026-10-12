'use client';

import { EmptyState } from '@/components/EmptyState';
import Link from 'next/link';
import { useTranslations } from 'next-intl';

import { Icon } from './Icon';

export interface ActivityView {
  id: string;
  action: string;
  actorName: string | null;
  hadActor: boolean;
  detail: string | null;
  whenLabel: string;
}

export interface EmailView {
  id: string;
  to: string;
  subject: string;
  status: string;
  error: string | null;
  whenLabel: string;
}

interface Props {
  view: 'activity' | 'email';
  activity: ActivityView[];
  emails: EmailView[];
  recentFailures: number;
  retentionDays: number;
}

/**
 * The history screen.
 *
 * An entry reads as a sentence — "Wren Halloway edited a post" — rather than
 * as `post.updated`, because the audit trail is for the person running the
 * agency, not for whoever wrote the event name.
 */
export function HistoryClient({
  view,
  activity,
  emails,
  recentFailures,
  retentionDays,
}: Props) {
  const t = useTranslations('history');

  /**
   * An action nobody has written copy for must not throw. next-intl raises on a
   * missing key, and a log screen that crashes on one unexpected row is worse
   * than one that says plainly that it does not recognise it.
   */
  function describe(action: string): string {
    const key = `actions.${action}` as Parameters<typeof t>[0];
    return t.has(key) ? t(key) : t('unknownAction', { action });
  }

  const tabs = [
    { key: 'activity' as const, href: '/settings/history', label: t('tabActivity') },
    { key: 'email' as const, href: '/settings/history?view=email', label: t('tabEmail') },
  ];

  return (
    <div className="space-y-4">
      <nav className="scroll-x flex gap-1">
        {tabs.map((tab) => (
          <Link
            key={tab.key}
            href={tab.href}
            aria-current={view === tab.key ? 'page' : undefined}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
              view === tab.key ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            {tab.label}
            {tab.key === 'email' && recentFailures > 0 && (
              <>
                {/* The bare number would be read as part of the tab's name ("Email1"). */}
                <span
                  aria-hidden
                  className="ms-1.5 rounded-full bg-red-100 px-1.5 text-[10px] font-semibold text-red-700"
                >
                  {recentFailures}
                </span>
                <span className="sr-only">{t('tabFailures', { count: recentFailures })}</span>
              </>
            )}
          </Link>
        ))}
      </nav>

      {/* Email failures are silent by design — that is the point of saying so
          here rather than waiting to be asked. */}
      {recentFailures > 0 && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {t('failuresBanner', { count: recentFailures })}
        </p>
      )}

      {view === 'activity' ? (
        activity.length === 0 ? (
          <EmptyState title={t('emptyActivity')} />
        ) : (
          <ul className="card divide-y divide-slate-100">
            {activity.map((row) => (
              <li key={row.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-1 px-4 py-3">
                <span className="text-sm text-slate-800">
                  <span className="font-medium text-slate-900">
                    {row.actorName ?? (row.hadActor ? t('byDeparted') : t('bySystem'))}
                  </span>{' '}
                  {describe(row.action)}
                </span>
                {row.detail && (
                  <span className="text-xs text-slate-500">— {row.detail}</span>
                )}
                <span className="ms-auto whitespace-nowrap text-xs text-slate-400">
                  {row.whenLabel}
                </span>
              </li>
            ))}
          </ul>
        )
      ) : emails.length === 0 ? (
        <EmptyState title={t('emptyEmail')} />
      ) : (
        <ul className="card divide-y divide-slate-100">
          {emails.map((row) => (
            <li key={row.id} className="px-4 py-3">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <StatusPill status={row.status} />
                <span className="text-sm text-slate-800">{row.subject}</span>
                <span className="text-xs text-slate-500">{row.to}</span>
                <span className="ms-auto whitespace-nowrap text-xs text-slate-400">
                  {row.whenLabel}
                </span>
              </div>

              {row.error && <p className="mt-1 text-xs text-red-700">{row.error}</p>}
              {row.status === 'skipped' && !row.error && (
                <p className="mt-1 text-xs text-slate-500">{t('skippedHint')}</p>
              )}
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs text-slate-500">
        <Icon name="clock" size={13} className="me-1 inline align-[-2px]" />
        {t('keptFor', { days: retentionDays })}
      </p>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const t = useTranslations('history');

  const styles: Record<string, string> = {
    sent: 'bg-emerald-50 text-emerald-700',
    failed: 'bg-red-50 text-red-700',
    skipped: 'bg-slate-100 text-slate-600',
  };
  const labels: Record<string, string> = {
    sent: t('statusSent'),
    failed: t('statusFailed'),
    skipped: t('statusSkipped'),
  };

  return (
    <span
      className={`badge ${styles[status] ?? styles.skipped}`}
    >
      {labels[status] ?? status}
    </span>
  );
}
