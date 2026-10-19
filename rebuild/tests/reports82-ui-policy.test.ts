import { describe, expect, it, vi } from 'vitest';
vi.mock('@/server/config/store', () => ({runtimeConfig:vi.fn()}));
import { DEFAULT_REPORT_UI_POLICY, REPORT_UI_POLICY_SCHEMA } from '../src/modules/analytics/report-ui-config';
import { runtimeConfig } from '../src/server/config/store';
import { loadReportUiPolicy } from '@/modules/analytics/server/report-ui-policy';

describe('Root-managed Reports presentation policy',()=>{
  it('accepts defaults and never offers unsupported sections as usable choices',()=>{
    const policy=REPORT_UI_POLICY_SCHEMA.parse(DEFAULT_REPORT_UI_POLICY);
    expect(policy.sectionOptions.map(item=>item.id)).toEqual(['analysis', 'goals', 'responseTime', 'audience', 'published', 'destinations', 'topPosts']);
    expect(REPORT_UI_POLICY_SCHEMA.safeParse({...DEFAULT_REPORT_UI_POLICY,enabledSections:['goals']}).success).toBe(false);
    expect(REPORT_UI_POLICY_SCHEMA.safeParse({...DEFAULT_REPORT_UI_POLICY,enabledSections:[...DEFAULT_REPORT_UI_POLICY.enabledSections,'bogus']}).success).toBe(false);
  });
  it('rejects duplicate choices and defaults absent from the offered choices',()=>{
    const policy=DEFAULT_REPORT_UI_POLICY;
    expect(REPORT_UI_POLICY_SCHEMA.safeParse({...policy,rangeOptions:[policy.rangeOptions[0],policy.rangeOptions[0]]}).success).toBe(false);
    expect(REPORT_UI_POLICY_SCHEMA.safeParse({...policy,rangeOptions:[{id:'today',label:'Today'}]}).success).toBe(false);
    expect(REPORT_UI_POLICY_SCHEMA.safeParse({...policy,enabledSections:['analysis']}).success).toBe(false);
  });
  it('reads validated Root configuration and fails closed on malformed policy',async()=>{
    vi.mocked(runtimeConfig).mockResolvedValue(DEFAULT_REPORT_UI_POLICY as never);
    expect(await loadReportUiPolicy()).toEqual(REPORT_UI_POLICY_SCHEMA.parse(DEFAULT_REPORT_UI_POLICY));
    expect(runtimeConfig).toHaveBeenCalledWith('analytics.reports.ui');
    vi.mocked(runtimeConfig).mockResolvedValue({} as never);
    await expect(loadReportUiPolicy()).rejects.toMatchObject({code:'unavailable'});
  });
});
