import type { ModuleManifest } from '../types';

export const analyticsManifest = {
  id: 'analytics',
  area: 'insights',
  health: { configuration: true, jobHistory: true, pendingQueues: [] },
  jobs: [{ name: 'analytics', label: 'Analytics synchronization', configKey: 'sync.analytics.schedule' }, { name: 'analyticsReports', label: 'Scheduled reports', configKey: 'analytics.reports.schedule' }],
  rootSettingsPrefixes: ['analytics.'],
  rootSettingKeys: ['sync.analytics.schedule', 'retention.analyticsDays'],
  title: 'Analytics',
  href: '/insights',
  /** Design v2 B5: Analytics' routes became the Insights area (the Ads module adds its own entries). */
  redirects: [
    { from: '/analytics', to: '/insights' },
    { from: '/analytics/explorer', to: '/insights/explore' },
    { from: '/analytics/demographics', to: '/insights/audience' },
    { from: '/analytics/posts', to: '/insights/posts' },
    { from: '/analytics/compare', to: '/insights/compare' },
    { from: '/analytics/ads', to: '/insights/ads/analysis' },
    { from: '/analytics/goals', to: '/insights/goals' },
    { from: '/analytics/pins', to: '/insights/pins' },
    { from: '/analytics/reports', to: '/insights/reports' },
    { from: '/analytics/notes', to: '/insights/notes' },
    { from: '/analytics/tests', to: '/insights/tests' },
  ],
  /** `tabOrder` fixes the Insights tabs across the Analytics and Ads modules: Overview, Explore, Audience, Posts, Compare, Ads, Reports. */
  pages: [
    { id: 'analytics/overview', title: 'Overview', href: '/insights', tabOrder: 10, description: 'Explore channel audience, performance and post metrics.' },
    { id: 'analytics/explorer', title: 'Explore', href: '/insights/explore', tabOrder: 20, description: 'Inspect every available stored metric, source and resource.' },
    { id: 'analytics/demographics', title: 'Audience', href: '/insights/audience', tabOrder: 30, description: 'Understand available audience breakdowns and coverage.' },
    { id: 'analytics/posts', title: 'Posts', href: '/insights/posts', tabOrder: 40, tabRoutes: ['/insights/tests'], description: 'Explore and export stored per-post measures.' },
    { id: 'analytics/compare', title: 'Compare', href: '/insights/compare', tabOrder: 50, description: 'Compare periods and selected resource groups with honest metric semantics.' },
    // Ad-object analysis is a sub-page of the Ads tab (Accounts · Campaigns · Manage · Analysis).
    { id: 'analytics/ads', title: 'Ads analysis', href: '/insights/ads/analysis', navigation: false, description: 'Explore paid campaign, ad set and ad performance separately from channel analytics.' },
    { id: 'analytics/reports', title: 'Reports', href: '/insights/reports', tabOrder: 70, description: 'Prepare reports, reuse templates and manage scheduled delivery.' },
    { id: 'analytics/goals', title: 'Goals', href: '/insights/goals', navigation: false, description: 'Set monthly goals per channel and track progress.' },
    { id: 'analytics/pins', title: 'Pinned metrics', href: '/insights/pins', navigation: false, description: 'Keep a personal view of available metrics.' },
  ],
} as const satisfies ModuleManifest;
