'use client';
import { usePublishingActionText } from '@/modules/publishing/ui/WorkflowSubmitButtons';

import { useSearchParams } from 'next/navigation';
import { CsvExportButton } from '@/components/CsvExportButton';

type ExportProps = { maxPosts: number; maxBytes: number };

export function PostExport({ maxPosts, maxBytes }: ExportProps) {
  const t = usePublishingActionText();
  const params = useSearchParams();
  const query = new URLSearchParams();
  for (const key of ['q', 'status', 'channel']) {
    const value = params.get(key);
    if (value) query.set(key, value);
  }
  return <CsvExportButton href={`/api/publishing/posts/export${query.size ? `?${query}` : ''}`} expectedFormat="posts-v1" rowCountHeader="x-msp-post-count" maxRows={maxPosts} maxBytes={maxBytes} fileName="posts.csv"
    copy={{ heading: t('exportPosts'), help: t('exportHelp', { posts: maxPosts.toLocaleString(), bytes: maxBytes.toLocaleString() }), action: t('exportMatchingPosts'), pending: t('preparingCSV'), noun: { singular: t('postSingular'), plural: t('postPlural') } }} />;
}
