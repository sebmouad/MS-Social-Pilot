import { headers } from 'next/headers';
import AnalyticsExplorerScreen from '@/modules/analytics/ui/explorer/ExplorerScreen';

export default async function InsightsExplorePage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const locale = /^\s*fr\b/i.test((await headers()).get('accept-language') ?? '') ? 'fr' : 'en';
  return <AnalyticsExplorerScreen searchParams={searchParams} locale={locale} />;
}
