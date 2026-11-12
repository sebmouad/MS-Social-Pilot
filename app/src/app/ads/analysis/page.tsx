import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

/** Ads analysis was folded into Ads › Manage (2026-11-12): the same figures per campaign, ad set and ad, with sorting and totals. */
export default async function AdsAnalysisPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { level } = await searchParams;
  redirect(`/ads/manage?level=${typeof level === 'string' && ['campaign', 'adset', 'ad'].includes(level) ? level : 'campaign'}`);
}
