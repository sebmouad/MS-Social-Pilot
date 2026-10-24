import type { LinkReport } from '../server/link-report';
import { documentText, type ReportDocumentCopy } from './copy';

export function linkDetails(report: LinkReport, copy: ReportDocumentCopy) {
  const t = documentText(copy);
  const notes = [
    t('Links belong to posts published to this channel in the report period. Only channel-attributed links and legacy links with one published destination are included.'),
    t('Lifetime clicks are running totals, not period clicks. Period and daily counts use retained click records; older records may have been deleted. Zero means no retained records, not proof of no clicks.'),
    t('Daily counts cover all eligible links independently of the link list limit. Days without retained clicks are omitted.'),
    ...(report.linksTruncated ? [t('The link inventory reached its row limit.')] : []),
    ...(report.daysTruncated ? [t('The daily click list reached its row limit.')] : []),
    ...(!report.links.length ? [t('No eligible stored short links for these publications.')] : []),
  ];
  const rows: unknown[][] = [
    ...report.links.flatMap(link => [
      ['short_link', 'link_lifetime_clicks', t('Link lifetime clicks'), link.postId, link.id, '', link.lifetime, 'clicks', '', notes[0]],
      ['short_link', 'link_period_clicks', t('Recorded link clicks in period'), link.postId, link.id, '', link.period, 'clicks', '', notes[1]],
    ]),
    ...report.days.map(day => ['short_link_day', 'link_daily_clicks', t('Daily recorded link clicks (UTC)'), '', '', day.day, day.clicks, 'clicks', '', notes[2]]),
    ...notes.map(note => ['short_link_coverage', 'link_basis', note, '', '', '', '', '', '', '']),
  ];
  return { notes, rows, truncated: report.linksTruncated || report.daysTruncated };
}
