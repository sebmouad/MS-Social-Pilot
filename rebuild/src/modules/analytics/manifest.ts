import type { ModuleManifest } from '../types';

export const analyticsManifest = {
  id: 'analytics',
  jobs: [{ name: 'analytics', label: 'Analytics synchronization', configKey: 'sync.analytics.schedule' }, { name: 'analyticsReports', label: 'Scheduled reports', configKey: 'analytics.reports.schedule' }],
  rootSettingsPrefixes: ['analytics.'],
  rootSettingKeys: ['sync.analytics.schedule', 'retention.analyticsDays'],
  title: 'Analytics',
  href: '/analytics',
  pages: [
    { id: 'analytics/overview', title: 'Analytics', href: '/analytics', description: 'Explore every available metric in one place.' },
    { id: 'analytics/explorer', title: 'Metric explorer', href: '/analytics/explorer', navigation: false, description: 'Inspect every available stored metric, source and resource.' },
    { id: 'analytics/demographics', title: 'Audience', href: '/analytics/demographics', description: 'Understand available audience breakdowns and coverage.' },
    { id: 'analytics/compare', title: 'Compare', href: '/analytics/compare', description: 'Compare periods and selected resource groups with honest metric semantics.' },
    { id: 'analytics/goals', title: 'Goals', href: '/analytics/goals', description: 'Set monthly goals per channel and track progress.' },
    { id: 'analytics/pins', title: 'Pinned metrics', href: '/analytics/pins', description: 'Keep a personal view of available metrics.' },
    { id: 'analytics/reports', title: 'Reports', href: '/analytics/reports', description: 'Prepare reports, reuse templates and manage scheduled delivery.' },
  ],
} as const satisfies ModuleManifest;
