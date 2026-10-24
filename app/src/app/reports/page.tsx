import { redirect } from 'next/navigation';

export default async function ReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = new URLSearchParams();
  const search = await searchParams;
  for (const [key, value] of Object.entries(search)) {
    if (!['start', 'end', 'filter', 'channel'].includes(key)) continue;
    for (const item of Array.isArray(value) ? value : value ? [value] : []) params.append(key, item);
  }
  redirect(`/insights${params.size ? `?${params}` : ''}`);
}
