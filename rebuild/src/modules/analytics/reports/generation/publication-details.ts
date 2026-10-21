import type { PublicationReport } from '../server/publication-report';
import { documentText, type ReportDocumentCopy } from './copy';

/** Long-form rows are shared by the four downloadable renderings. */
export function publicationDetails(report: PublicationReport, copy: ReportDocumentCopy) {
  const t = documentText(copy);
  const notes = [t('Publication details are from stored destination state. Daily totals use UTC publication dates; days without publications are omitted.'),
    t('Failures are destinations currently marked failed and last updated in this period, not a history of every failed attempt. Review the post before retrying.'),
    t('Content excerpts may be shortened. Other destinations and provider error details are not included.'),
    ...(report.publishedTruncated ? [t('The publication log reached its row limit; daily totals still cover the full period.')] : []),
    ...(report.failedTruncated ? [t('The failed destination list reached its row limit.')] : []),
    ...(!report.published.length ? [t('No stored publications in this period.')] : []),
    ...(!report.failed.length ? [t('No currently failed destinations updated in this period.')] : [])];
  const rows: unknown[][] = [
    ...report.days.map(day => ['publication_day', 'published_daily', t('Daily publications (UTC)'), '', '', day.day, day.published, 'posts', '', t('Count in period')]),
    ...report.published.map(post => ['publication_log', 'published_post', post.text || t('(no text)'), t('Publication log'), post.postId, post.at, post.attempts, t('Attempts'), '', t('Published')]),
    ...report.failed.map(post => ['publication_failure', 'failed_destination', post.text || t('(no text)'), t('Currently failed destinations'), post.postId, post.at, post.attempts, t('Attempts'), '', t('Failures are destinations currently marked failed and last updated in this period, not a history of every failed attempt. Review the post before retrying.')]),
    ...notes.map(note => ['publication_coverage', 'publication_basis', note, '', '', '', '', '', '', '']),
  ];
  return { notes, rows, truncated: report.publishedTruncated || report.failedTruncated };
}
