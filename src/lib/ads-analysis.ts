import { change } from './page-analysis';

/**
 * Reading an ad account's numbers for somebody, the way the page analysis
 * reads a Page's.
 *
 * Pure: two periods of totals and a list of campaigns in, KPIs and findings
 * out. The same principles as the page analysis — compare the account with its
 * own last period, never with an industry benchmark, and say nothing on a
 * sample too small to carry it.
 */

export interface AdPeriodTotals {
  spend: number;
  impressions: number;
  clicks: number;
  cpc: number | null;
  cpm: number | null;
  ctr: number | null;
}

export type AdKpiKey = 'spend' | 'impressions' | 'clicks' | 'ctr' | 'cpc' | 'cpm';

export interface AdKpi {
  key: AdKpiKey;
  current: number | null;
  previous: number | null;
  change: number | null;
  /**
   * Which way is good. Null for spend, which is neither: spending more is the
   * plan as often as it is the problem, and colouring it would be a verdict
   * this screen cannot give.
   */
  upIsGood: boolean | null;
}

export function adKpis(current: AdPeriodTotals, previous: AdPeriodTotals): AdKpi[] {
  const kpi = (key: AdKpiKey, upIsGood: boolean | null): AdKpi => ({
    key,
    current: current[key],
    previous: previous[key],
    change: change(current[key], previous[key]),
    upIsGood,
  });

  return [
    kpi('spend', null),
    kpi('impressions', true),
    kpi('clicks', true),
    kpi('ctr', true),
    // Paying less per click and per thousand views is the good direction.
    kpi('cpc', false),
    kpi('cpm', false),
  ];
}

export interface AdCampaignFigures {
  objectId: string;
  name: string;
  spend: number;
  impressions: number;
  clicks: number;
  cpc: number | null;
  ctr: number | null;
}

export interface AdFinding {
  tone: 'good' | 'warning' | 'info';
  /** Key under `ads.findings`. */
  key: string;
  params: Record<string, string | number>;
}

/** Impressions a campaign needs before its click-through rate means anything. */
export const MIN_IMPRESSIONS = 1000;
/** Clicks a campaign needs before its cost per click means anything. */
export const MIN_CLICKS = 30;

/**
 * The few things worth saying about an ad account's period, most useful first.
 *
 * Every campaign-level rule needs enough delivery behind it — a campaign with
 * two clicks has a cost per click, but not one anybody should act on.
 */
export function adFindings(input: {
  current: AdPeriodTotals;
  previous: AdPeriodTotals;
  campaigns: AdCampaignFigures[];
}): AdFinding[] {
  const out: AdFinding[] = [];
  const { current, previous, campaigns } = input;

  if (current.spend === 0) {
    out.push({ tone: 'info', key: 'noSpend', params: {} });
    return out;
  }

  const cpcChange = change(current.cpc, previous.cpc);
  if (cpcChange !== null && Math.abs(cpcChange) >= 15) {
    out.push({
      tone: cpcChange < 0 ? 'good' : 'warning',
      key: cpcChange < 0 ? 'cpcDown' : 'cpcUp',
      params: { percent: Math.abs(cpcChange) },
    });
  }

  const ctrChange = change(current.ctr, previous.ctr);
  if (ctrChange !== null && Math.abs(ctrChange) >= 15) {
    out.push({
      tone: ctrChange > 0 ? 'good' : 'warning',
      key: ctrChange > 0 ? 'ctrUp' : 'ctrDown',
      params: { percent: Math.abs(ctrChange) },
    });
  }

  const spending = campaigns.filter((campaign) => campaign.spend > 0);
  if (spending.length >= 2) {
    const top = [...spending].sort((a, b) => b.spend - a.spend)[0]!;
    const share = Math.round((top.spend / current.spend) * 100);
    if (share >= 60) {
      out.push({ tone: 'info', key: 'concentrated', params: { name: top.name, share } });
    }
  }

  if (current.ctr !== null && current.ctr > 0) {
    const best = campaigns
      .filter((campaign) => campaign.impressions >= MIN_IMPRESSIONS && campaign.ctr !== null)
      .sort((a, b) => b.ctr! - a.ctr!)[0];
    if (best && best.ctr! >= current.ctr * 1.5) {
      out.push({
        tone: 'good',
        key: 'bestCtr',
        params: { name: best.name, ratio: Math.round((best.ctr! / current.ctr) * 10) / 10 },
      });
    }
  }

  if (current.cpc !== null && current.cpc > 0) {
    const costly = campaigns
      .filter(
        (campaign) =>
          campaign.clicks >= MIN_CLICKS && campaign.cpc !== null && campaign.spend / current.spend >= 0.1,
      )
      .sort((a, b) => b.cpc! - a.cpc!)[0];
    if (costly && costly.cpc! >= current.cpc * 1.5) {
      out.push({
        tone: 'warning',
        key: 'costlyClicks',
        params: { name: costly.name, ratio: Math.round((costly.cpc! / current.cpc) * 10) / 10 },
      });
    }
  }

  return out;
}
