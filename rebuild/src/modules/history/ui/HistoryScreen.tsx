import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { IconAlertTriangle, IconInfoCircle } from '@tabler/icons-react';
import { Avatar } from '@/components/Avatar';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { DataTable } from '@/components/DataTable';
import { EmptyState } from '@/components/EmptyState';
import { formatStableDateTime } from '@/components/LocalTime';
import { PageHeader } from '@/components/PageHeader';
import { OperationError } from '@/lib/operation-error';
import { configOrDefault } from '@/server/config/config-or-default';
import { requireViewer } from '@/server/context';
import { PageFrame } from '@/server/PageFrame';
import { HISTORY_COPY, actionLabel, fill, historyActionLabelsSchema, historyCopySchema, historyLocale, type HistoryCopy, type HistoryLocale } from '../copy';
import { HISTORY_FEATURE_ID } from '../semantics';
import { listWorkspaceActivity, listWorkspaceEmails } from '../server/history';
import styles from './history.module.css';

export const metadata: Metadata = { title: 'History' };
const ALLOWED = ['view', 'q', 'offset', 'problems'];
type Params = Record<string, string | string[] | undefined>;

function parse(params: Params) {
  if (Object.entries(params).some(([key, value]) => !ALLOWED.includes(key) || typeof value !== 'string')) return null;
  const offset = params.offset === undefined ? 0 : /^\d{1,9}$/.test(String(params.offset)) ? Number(params.offset) : NaN;
  if (Number.isNaN(offset) || (params.view !== undefined && params.view !== 'activity' && params.view !== 'email')) return null;
  return { view: (params.view === 'email' ? 'email' : 'activity') as 'activity' | 'email', q: String(params.q ?? '').trim(), offset, problems: params.problems === '1' };
}

function href(view: string, filters: { q?: string; problems?: boolean; offset?: number }) {
  const query = new URLSearchParams();
  if (view === 'email') query.set('view', 'email');
  if (filters.q) query.set('q', filters.q);
  if (filters.problems) query.set('problems', '1');
  if (filters.offset) query.set('offset', String(filters.offset));
  return `/settings/history${query.size ? `?${query}` : ''}`;
}

export default async function HistoryScreen({ searchParams }: { searchParams: Promise<Params> }) {
  const viewer = await requireViewer({ module: 'settings', feature: HISTORY_FEATURE_ID });
  const locale = historyLocale((await headers()).get('accept-language'));
  const [catalog, labels] = await Promise.all([configOrDefault('history.customerCopy', historyCopySchema).catch(() => HISTORY_COPY), configOrDefault('history.actionLabels', historyActionLabelsSchema).catch(() => ({}))]);
  const t = catalog[locale];
  const parsed = parse(await searchParams);
  const frame = (body: React.ReactNode) => <PageFrame module="settings"><div className={styles.root} data-module="settings"><PageHeader module="settings" title={t.title} description={t.description} />{body}</div></PageFrame>;
  if (!parsed) return frame(<EmptyState tone="error" title={t.noMatchTitle}>{t.invalidFilters}<br /><a href="/settings/history">{t.clear}</a></EmptyState>);

  const actor = { userId: viewer.user.id, workspaceId: viewer.workspaceId };
  const filters = { ...(parsed.q ? { q: parsed.q } : {}), offset: parsed.offset };
  const tabs = <nav className={styles.tabs} aria-label={t.tabsLabel}>
    <a className={styles.tab} href="/settings/history" aria-current={parsed.view === 'activity' ? 'page' : undefined}>{t.tabActivity}</a>
    <a className={styles.tab} href="/settings/history?view=email" aria-current={parsed.view === 'email' ? 'page' : undefined}>{t.tabEmail}</a>
  </nav>;

  try {
    if (parsed.view === 'activity') {
      const data = await listWorkspaceActivity(actor, filters);
      const filtered = Boolean(parsed.q);
      return frame(<>
        {tabs}
        <Toolbar t={t} view="activity" q={parsed.q} problems={false} />
        {data.retentionDays !== null && <p className={styles.footnote}>{fill(t.retention, { days: data.retentionDays })}</p>}
        <DataTable caption={t.activityCaption} rows={data.items} rowKey={row => row.id} density="compact"
          emptyIcon={undefined} emptyMessage={filtered ? t.noMatch : t.emptyActivity}
          emptyAction={filtered ? <a href="/settings/history">{t.clear}</a> : undefined}
          columns={[
            { key: 'when', label: t.when, width: '190px', render: row => <time dateTime={row.createdAt}>{formatStableDateTime(row.createdAt, { locale, timeZone: data.timeZone })}</time> },
            { key: 'who', label: t.who, width: '200px', render: row => row.actorName
              ? <span className={styles.who}><Avatar name={row.actorName} size="sm" decorative />{row.actorName}</span>
              : <Badge tone="neutral">{row.hadActor ? t.formerMember : t.systemActor}</Badge> },
            { key: 'what', label: t.what, render: row => <span className={styles.what}><strong>{actionLabel(row.action, locale, labels)}</strong><span className={styles.code}>{row.action}</span></span> },
            { key: 'details', label: t.details, render: row => row.details.length
              ? <ul className={styles.details}>{row.details.map(item => <li key={item.key}><b>{item.key}</b> {item.value}</li>)}</ul>
              : <span className={styles.muted} aria-hidden="true">—</span> },
          ]} />
        <Pager t={t} view="activity" filters={{ q: parsed.q }} offset={data.offset} size={data.pageSize} count={data.items.length} hasMore={data.hasMore} />
      </>);
    }
    const data = await listWorkspaceEmails(actor, { ...filters, ...(parsed.problems ? { problemsOnly: true } : {}) });
    const filtered = Boolean(parsed.q) || parsed.problems;
    const status = (value: string) => value === 'sent' ? { tone: 'success' as const, label: t.statusSent } : value === 'failed' ? { tone: 'danger' as const, label: t.statusFailed } : value === 'skipped' ? { tone: 'neutral' as const, label: t.statusSkipped } : { tone: 'neutral' as const, label: t.statusOther };
    return frame(<>
      {tabs}
      <p className={styles.notice} data-tone={data.recentFailures > 0 ? 'warning' : undefined} role={data.recentFailures > 0 ? 'status' : undefined}>
        {data.recentFailures > 0 ? <IconAlertTriangle size={18} aria-hidden="true" /> : <IconInfoCircle size={18} aria-hidden="true" />}
        <span>{fill(data.recentFailures > 0 ? t.recentFailures : t.noRecentFailures, { count: data.recentFailures, days: data.recentFailureDays })}</span>
      </p>
      <Toolbar t={t} view="email" q={parsed.q} problems={parsed.problems} />
      <DataTable caption={t.emailCaption} rows={data.items} rowKey={row => row.id} density="compact"
        emptyMessage={filtered ? t.noMatch : t.emptyEmail}
        emptyAction={filtered ? <a href={href('email', {})}>{t.clear}</a> : undefined}
        columns={[
          { key: 'when', label: t.when, width: '190px', render: row => <time dateTime={row.createdAt}>{formatStableDateTime(row.createdAt, { locale, timeZone: data.timeZone })}</time> },
          { key: 'to', label: t.to, render: row => <span className={styles.subject}>{row.to}</span> },
          { key: 'subject', label: t.subject, render: row => <span className={styles.subject}>{row.subject}</span> },
          { key: 'status', label: t.status, width: '150px', render: row => { const s = status(row.status); return <span><Badge tone={s.tone}>{s.label}</Badge>{row.error && <><br /><span className={styles.problem}><span className={styles.srOnly}>{t.problem}: </span>{row.error}</span></>}</span>; } },
        ]} />
      <Pager t={t} view="email" filters={{ q: parsed.q, problems: parsed.problems }} offset={data.offset} size={data.pageSize} count={data.items.length} hasMore={data.hasMore} />
    </>);
  } catch (error) {
    const known = error instanceof OperationError && error.code === 'invalid_request';
    return frame(<EmptyState tone="error" title={t.loadFailureTitle}>{known ? t.invalidFilters : t.loadFailure}</EmptyState>);
  }
}

/** Plain GET form: filters stay in the address, work without script and survive reload. */
function Toolbar({ t, view, q, problems }: { t: HistoryCopy; view: 'activity' | 'email'; q: string; problems: boolean }) {
  return <form className={styles.toolbar} method="get" action="/settings/history" role="search">
    {view === 'email' && <input type="hidden" name="view" value="email" />}
    <label className={styles.field}><span>{view === 'email' ? t.searchEmail : t.searchActivity}</span><input type="search" name="q" defaultValue={q} autoComplete="off" /></label>
    {view === 'email' && <label className={styles.check}><input type="checkbox" name="problems" value="1" defaultChecked={problems} />{t.failuresOnly}</label>}
    <div className={styles.actions}><Button type="submit" variant="primary">{t.filter}</Button>{(q || problems) && <a href={href(view, {})}>{t.clear}</a>}</div>
  </form>;
}

function Pager({ t, view, filters, offset, size, count, hasMore }: { t: HistoryCopy; view: string; filters: { q?: string; problems?: boolean }; offset: number; size: number; count: number; hasMore: boolean }) {
  if (offset === 0 && !hasMore) return null;
  return <nav className={styles.page} aria-label={t.pagesLabel}>
    {offset > 0 ? <a href={href(view, { ...filters, offset: Math.max(0, offset - size) })}>{t.previous}</a> : <span />}
    <span>{fill(t.rangeLabel, { from: offset + 1, to: offset + count })}</span>
    {hasMore ? <a href={href(view, { ...filters, offset: offset + size })}>{t.next}</a> : <span />}
  </nav>;
}

export type { HistoryLocale };
