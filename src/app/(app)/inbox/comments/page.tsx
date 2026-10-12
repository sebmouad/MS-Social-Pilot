import { screenMetadata } from '@/lib/metadata';

import { AnalyticsScreen } from '../../analytics/AnalyticsScreen';

export const dynamic = 'force-dynamic';

export function generateMetadata() {
  return screenMetadata('analytics.view.comments');
}

export default function Page(props: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <AnalyticsScreen {...props} only="comments" />;
}
