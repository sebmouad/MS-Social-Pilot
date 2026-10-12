import { screenMetadata } from '@/lib/metadata';

import { AnalyticsScreen } from './AnalyticsScreen';

export const dynamic = 'force-dynamic';

/** The tab says which screen and which client, so several open at once stay apart. */
export function generateMetadata() {
  return screenMetadata('analytics.title');
}

export default function AnalyticsPage(props: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <AnalyticsScreen {...props} />;
}
