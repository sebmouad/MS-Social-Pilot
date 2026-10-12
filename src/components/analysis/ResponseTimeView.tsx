import { Fragment } from 'react';
import { getFormatter, getTranslations } from 'next-intl/server';

import { EmptyState } from '@/components/EmptyState';
import { businessHoursOf, readResponseTimes } from '@/lib/inbox-response';
import { prisma } from '@/lib/prisma';
import { durationParts, type ResponseSummary } from '@/lib/response-time';

/**
 * How fast the team answers comments and messages (NEXT_PHASES H11), per
 * Page and per member, read from what the sync stored.
 */
export async function ResponseTimeView(props: {
  workspaceId: string;
  targetIds: string[];
  from: Date;
  to: Date;
  timeZone: string;
  /** Inside a report, under the section's own heading. */
  nested?: boolean;
}) {
  const t = await getTranslations('responseTime');
  const format = await getFormatter();
  const workspace = await prisma.workspace.findUniqueOrThrow({
    where: { id: props.workspaceId },
    select: { businessDays: true, businessStart: true, businessEnd: true },
  });
  const hours = businessHoursOf(workspace);
  const data = await readResponseTimes({ ...props, hours });
  const Heading = props.nested ? 'h3' : 'h2';

  const duration = (ms: number | null) => {
    if (ms === null) return '—';
    const parts = durationParts(ms);
    return t(`duration_${parts.unit}`, { major: parts.major, minor: parts.minor });
  };
  const waiting = data.pages.reduce((sum, page) => sum + page.comments.total + page.messages.total, 0);

  if (waiting === 0) {
    return <EmptyState icon="inbox" title={t('emptyTitle')} hint={t('emptyBody')} />;
  }

  const row = (label: string, summary: ResponseSummary) => (
    <tr className="border-t border-slate-100">
      <th scope="row" className="py-2 pe-3 text-start font-medium text-slate-700">{label}</th>
      <td className="py-2 pe-3 tabular-nums">{format.number(summary.total)}</td>
      <td className="py-2 pe-3 tabular-nums">{summary.total ? `${format.number(Math.round((summary.answered / summary.total) * 100))} %` : '—'}</td>
      <td className="py-2 pe-3 tabular-nums">{duration(summary.medianFirstMs)}</td>
      <td className="py-2 pe-3 tabular-nums">{duration(summary.slowestFirstMs)}</td>
      <td className="py-2 tabular-nums">{duration(summary.medianResolveMs)}</td>
    </tr>
  );
  const head = (first: string) => (
    <thead>
      <tr className="text-start text-xs font-semibold text-slate-500">
        <th scope="col" className="pb-2 pe-3">{first}</th>
        <th scope="col" className="pb-2 pe-3">{t('waiting')}</th>
        <th scope="col" className="pb-2 pe-3">{t('answeredShare')}</th>
        <th scope="col" className="pb-2 pe-3">{t('medianFirst')}</th>
        <th scope="col" className="pb-2 pe-3">{t('slowestFirst')}</th>
        <th scope="col" className="pb-2">{t('medianResolve')}</th>
      </tr>
    </thead>
  );

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">{hours ? t('businessHoursOn') : t('businessHoursOff')}</p>
      <section className="card p-4" aria-labelledby="response-pages">
        <Heading id="response-pages" className="text-base font-semibold text-slate-900">{t('byPage')}</Heading>
        <div className="scroll-x mt-3">
          <table className="data-table w-full min-w-[560px] text-sm">
            {head(t('page'))}
            <tbody>
              {data.pages.map((page) => (
                <Fragment key={page.targetId}>
                  {row(t('comments', { page: page.name }), page.comments)}
                  {row(t('messages', { page: page.name }), page.messages)}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="card p-4" aria-labelledby="response-members">
        <Heading id="response-members" className="text-base font-semibold text-slate-900">{t('byMember')}</Heading>
        <p className="mt-1 text-xs text-slate-500">{t('byMemberHint')}</p>
        <div className="scroll-x mt-3">
          <table className="data-table w-full min-w-[360px] text-sm">
            <thead>
              <tr className="text-start text-xs font-semibold text-slate-500">
                <th scope="col" className="pb-2 pe-3">{t('member')}</th>
                <th scope="col" className="pb-2 pe-3">{t('answered')}</th>
                <th scope="col" className="pb-2">{t('medianFirst')}</th>
              </tr>
            </thead>
            <tbody>
              {data.members.map((member) => (
                <tr key={member.userId ?? 'facebook'} className="border-t border-slate-100">
                  <th scope="row" className="py-2 pe-3 text-start font-medium text-slate-700">
                    {member.userId ? (member.name ?? t('formerMember')) : t('onFacebook')}
                  </th>
                  <td className="py-2 pe-3 tabular-nums">{format.number(member.summary.answered)}</td>
                  <td className="py-2 tabular-nums">{duration(member.summary.medianFirstMs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
