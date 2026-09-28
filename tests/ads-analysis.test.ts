import { describe, expect, it } from 'vitest';

import { adFindings, adKpis, type AdCampaignFigures, type AdPeriodTotals } from '../src/lib/ads-analysis';

/**
 * Reading an ad account's period. As with the page analysis, the tests are
 * mostly about when a finding must not appear: on a campaign with too little
 * delivery to judge, or a change too small to matter.
 */

function totals(overrides: Partial<AdPeriodTotals> = {}): AdPeriodTotals {
  return { spend: 100, impressions: 10_000, clicks: 200, cpc: 0.5, cpm: 10, ctr: 2, ...overrides };
}

function campaign(overrides: Partial<AdCampaignFigures> & { name: string }): AdCampaignFigures {
  return { objectId: overrides.name, spend: 10, impressions: 2000, clicks: 40, cpc: 0.25, ctr: 2, ...overrides };
}

describe('adKpis', () => {
  it('says which way is good, and that spend is neither', () => {
    const kpis = adKpis(totals({ spend: 150, cpc: 0.4 }), totals());
    expect(kpis.find((kpi) => kpi.key === 'spend')).toMatchObject({ change: 50, upIsGood: null });
    expect(kpis.find((kpi) => kpi.key === 'cpc')).toMatchObject({ change: -20, upIsGood: false });
    expect(kpis.find((kpi) => kpi.key === 'ctr')?.upIsGood).toBe(true);
  });

  it('has no change against a period that spent nothing', () => {
    const kpis = adKpis(totals(), totals({ spend: 0, cpc: null }));
    expect(kpis.find((kpi) => kpi.key === 'spend')?.change).toBeNull();
    expect(kpis.find((kpi) => kpi.key === 'cpc')?.change).toBeNull();
  });
});

describe('adFindings', () => {
  it('says only that nothing was spent, when nothing was', () => {
    const result = adFindings({ current: totals({ spend: 0 }), previous: totals(), campaigns: [] });
    expect(result.map((finding) => finding.key)).toEqual(['noSpend']);
  });

  it('notices clicks getting cheaper, but not by a hair', () => {
    expect(
      adFindings({ current: totals({ cpc: 0.4 }), previous: totals(), campaigns: [] }).map((finding) => finding.key),
    ).toContain('cpcDown');
    expect(
      adFindings({ current: totals({ cpc: 0.48 }), previous: totals(), campaigns: [] }).map((finding) => finding.key),
    ).not.toContain('cpcDown');
  });

  it('points out a budget that went mostly one way', () => {
    const result = adFindings({
      current: totals({ spend: 100 }),
      previous: totals(),
      campaigns: [campaign({ name: 'Big', spend: 70 }), campaign({ name: 'Small', spend: 30 })],
    });
    expect(result.find((finding) => finding.key === 'concentrated')?.params).toEqual({ name: 'Big', share: 70 });
  });

  it('names a campaign clicked far more often, but only with the impressions to show it', () => {
    const strong = campaign({ name: 'Video', impressions: 5000, ctr: 4 });
    const lucky = campaign({ name: 'Tiny', impressions: 50, ctr: 20 });
    const result = adFindings({ current: totals({ ctr: 2 }), previous: totals(), campaigns: [lucky, strong] });
    expect(result.find((finding) => finding.key === 'bestCtr')?.params).toEqual({ name: 'Video', ratio: 2 });
  });

  it('warns about expensive clicks only where they cost real money', () => {
    const costly = campaign({ name: 'Retargeting', spend: 30, clicks: 40, cpc: 1.5 });
    const trivial = campaign({ name: 'Test', spend: 2, clicks: 40, cpc: 3 });
    const result = adFindings({ current: totals({ cpc: 0.5 }), previous: totals(), campaigns: [costly, trivial] });
    expect(result.find((finding) => finding.key === 'costlyClicks')?.params).toEqual({ name: 'Retargeting', ratio: 3 });
  });
});
