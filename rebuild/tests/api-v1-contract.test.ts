import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ANALYTICS_MCP } from '../src/modules/analytics/mcp';
import { ADS_MCP } from '../src/modules/ads/mcp';
import { KEY_POST_ACTIONS } from '../src/modules/publishing/server/api-actions';
import { REST_POSTS_QUERY_KEYS } from '../src/modules/integrations/server/rest';
import type { McpToolGroup } from '../src/server/mcp/kit';

const doc = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../docs/API_V1.md'), 'utf8');

function operations(groups: readonly McpToolGroup[]): Map<string, { feature: string; write: boolean }> {
  const map = new Map<string, { feature: string; write: boolean }>();
  for (const group of groups) {
    const writes = new Set(group.writeTools ?? []);
    for (const tool of group.tools) map.set(tool.name, { feature: (group.features as Record<string, string>)[tool.name]!, write: writes.has(tool.name) });
  }
  return map;
}

/** The versioned v1 surface. Any change here is a contract change: update docs/API_V1.md in the same batch. */
const ANALYTICS_V1: Record<string, { feature: string; write: boolean }> = {
  export_analytics_report: { feature: 'analytics/reports', write: false },
  list_report_templates: { feature: 'analytics/reports', write: false },
  manage_report_template: { feature: 'analytics/reports', write: true },
  list_report_schedules: { feature: 'analytics/reports', write: false },
  manage_report_schedule: { feature: 'analytics/reports', write: true },
  list_report_runs: { feature: 'analytics/reports', write: false },
  generate_report: { feature: 'analytics/reports', write: true },
  get_analytics_posts: { feature: 'analytics/posts', write: false },
  get_analytics_ad_objects: { feature: 'analytics/ads', write: false },
  get_analytics_pins: { feature: 'analytics/pins', write: false },
  pin_analytics_metric: { feature: 'analytics/pins', write: true },
  unpin_analytics_metric: { feature: 'analytics/pins', write: true },
  reorder_analytics_pins: { feature: 'analytics/pins', write: true },
  get_analytics_goals: { feature: 'analytics/goals', write: false },
  set_analytics_goals: { feature: 'analytics/goals', write: true },
  get_analytics_demographics: { feature: 'analytics/demographics', write: false },
  compare_analytics: { feature: 'analytics/compare', write: false },
  get_analytics_explorer: { feature: 'analytics/explorer', write: false },
  list_metric_alerts: { feature: 'analytics/reports', write: false },
  manage_metric_alert: { feature: 'analytics/reports', write: true },
  get_analytics_overview: { feature: 'analytics/overview', write: false },
  get_analytics_metric_details: { feature: 'analytics/overview', write: false },
};
const ADS_V1: Record<string, { feature: string; write: boolean }> = {
  get_ads_report_rows: { feature: 'ads/campaigns', write: false },
  export_ads_report: { feature: 'ads/campaigns', write: false },
  list_ad_accounts: { feature: 'ads/campaigns', write: false },
  get_ad_creation_options: { feature: 'ads/campaigns', write: false },
  get_ads_performance: { feature: 'ads/campaigns', write: false },
  get_live_ad_status: { feature: 'ads/campaigns', write: false },
  create_ad_campaign: { feature: 'ads/campaigns', write: true },
  create_ad_set: { feature: 'ads/campaigns', write: true },
  update_ad: { feature: 'ads/campaigns', write: true },
  compare_ads_performance: { feature: 'ads/compare', write: false },
  list_ads_objects: { feature: 'ads/objects', write: false },
  get_ads_object: { feature: 'ads/objects', write: false },
  get_ads_management_options: { feature: 'ads/campaigns', write: false },
  get_ads_creative_image: { feature: 'ads/campaigns', write: false },
  list_ads_creative_sources: { feature: 'ads/campaigns', write: false },
  preview_ads_change: { feature: 'ads/campaigns', write: false },
  apply_ads_change: { feature: 'ads/campaigns', write: true },
  list_ads_changes: { feature: 'ads/campaigns', write: false },
  resolve_ads_change: { feature: 'ads/campaigns', write: true },
  list_ads_creatives: { feature: 'ads/campaigns', write: false },
};

describe('public API v1 contract', () => {
  it('exposes exactly the versioned Analytics operations with their grants', () => {
    expect(Object.fromEntries(operations(ANALYTICS_MCP))).toEqual(ANALYTICS_V1);
  });

  it('exposes exactly the versioned Ads operations with their grants', () => {
    expect(Object.fromEntries(operations(ADS_MCP))).toEqual(ADS_V1);
  });

  it('serves the documented post scheduling actions and list filters', () => {
    expect([...KEY_POST_ACTIONS]).toEqual(['schedule', 'reschedule', 'cancel-schedule', 'queue']);
    expect([...REST_POSTS_QUERY_KEYS]).toEqual(['status', 'from', 'to', 'limit', 'channelId', 'pages', 'q']);
  });

  it('documents every versioned operation, route and scheduling action', () => {
    for (const name of [...Object.keys(ANALYTICS_V1), ...Object.keys(ADS_V1)]) {
      expect(doc, `missing operation ${name}`).toContain(`\`${name}\``);
    }
    for (const route of ['/api/v1/me', '/api/v1/pages', '/api/v1/posts', '/api/v1/posts/[id]/schedule', '/api/v1/posts/[id]/reschedule', '/api/v1/posts/[id]/cancel-schedule', '/api/v1/posts/[id]/queue', '/api/v1/analytics/[operation]', '/api/v1/ads/[operation]', '/api/v1/webhooks', '/api/v1/webhooks/[id]']) {
      expect(doc, `missing route ${route}`).toContain(route);
    }
    for (const filter of ['status', 'from', 'to', 'limit', 'q', 'channelId']) {
      expect(doc, `missing posts filter ${filter}`).toContain(filter);
    }
    expect(doc).toContain('v1.0');
  });

  it('exports handlers for every versioned route family', async () => {
    const me = await import('../src/app/api/v1/me/route');
    const pages = await import('../src/app/api/v1/pages/route');
    const posts = await import('../src/app/api/v1/posts/route');
    const actions = await import('../src/app/api/v1/posts/[id]/[action]/route');
    const analytics = await import('../src/app/api/v1/analytics/[operation]/route');
    const ads = await import('../src/app/api/v1/ads/[operation]/route');
    const webhooks = await import('../src/app/api/v1/webhooks/route');
    const webhook = await import('../src/app/api/v1/webhooks/[id]/route');
    expect(typeof me.GET).toBe('function');
    expect(typeof pages.GET).toBe('function');
    expect(typeof posts.GET).toBe('function');
    expect(typeof posts.POST).toBe('function');
    expect(typeof actions.POST).toBe('function');
    expect(typeof analytics.GET).toBe('function');
    expect(typeof analytics.POST).toBe('function');
    expect(typeof ads.GET).toBe('function');
    expect(typeof ads.POST).toBe('function');
    expect(typeof webhooks.GET).toBe('function');
    expect(typeof webhooks.POST).toBe('function');
    expect(typeof webhook.DELETE).toBe('function');
  });
});
