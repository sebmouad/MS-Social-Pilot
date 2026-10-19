'use client';

import { useSearchParams } from 'next/navigation';
import { CsvExportButton } from '@/components/CsvExportButton';

type ExportProps = { maxPosts: number; maxBytes: number };

export function PostExport({ maxPosts, maxBytes }: ExportProps) {
  const params = useSearchParams();
  const query = new URLSearchParams();
  for (const key of ['q', 'status', 'channel']) {
    const value = params.get(key);
    if (value) query.set(key, value);
  }
  return <CsvExportButton href={`/api/publishing/posts/export${query.size ? `?${query}` : ''}`} expectedFormat="posts-v1" rowCountHeader="x-msp-post-count" maxRows={maxPosts} maxBytes={maxBytes} fileName="posts.csv"
    copy={{ heading: 'Export posts', help: `Export the complete set of posts matching your applied search, status, and channel filters across all pages, up to ${maxPosts.toLocaleString()} posts and ${maxBytes.toLocaleString()} bytes. The selected page and view do not limit the export.`, action: 'Export matching posts', pending: 'Preparing CSV…', noun: { singular: 'post', plural: 'posts' } }} />;
}
