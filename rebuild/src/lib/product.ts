/** Customer modules and routes for the new product. No legacy path aliases. */
export type ModuleId = 'home' | 'publishing' | 'inbox' | 'analytics' | 'ads' | 'settings';
export type FeatureId =
  | 'home/overview'
  | 'publishing/posts' | 'publishing/calendar' | 'publishing/queue' | 'publishing/approvals'
  | 'inbox/conversations' | 'analytics/overview' | 'analytics/reports'
  | 'ads/overview' | 'ads/campaigns'
  | 'settings/connections' | 'settings/team' | 'settings/account';

export interface ProductPage {
  id: FeatureId;
  title: string;
  href: string;
  module: ModuleId;
  description: string;
}

export const PAGES: readonly ProductPage[] = [
  { id: 'home/overview', title: 'Overview', href: '/home', module: 'home', description: 'Your work at a glance.' },
  { id: 'publishing/posts', title: 'Posts', href: '/publishing/posts', module: 'publishing', description: 'Create and manage content across your channels.' },
  { id: 'publishing/calendar', title: 'Calendar', href: '/publishing/calendar', module: 'publishing', description: 'See what is planned and published.' },
  { id: 'publishing/queue', title: 'Queue', href: '/publishing/queue', module: 'publishing', description: 'Review work waiting to publish.' },
  { id: 'publishing/approvals', title: 'Approvals', href: '/publishing/approvals', module: 'publishing', description: 'Review posts before they go live.' },
  { id: 'inbox/conversations', title: 'Inbox', href: '/inbox', module: 'inbox', description: 'Follow conversations across channels.' },
  { id: 'analytics/overview', title: 'Analytics', href: '/analytics', module: 'analytics', description: 'Explore every available metric in one place.' },
  { id: 'analytics/reports', title: 'Reports', href: '/analytics/reports', module: 'analytics', description: 'Save and share what matters.' },
  { id: 'ads/overview', title: 'Ad accounts', href: '/ads', module: 'ads', description: 'See paid performance across accounts.' },
  { id: 'ads/campaigns', title: 'Campaigns', href: '/ads/campaigns', module: 'ads', description: 'Manage campaign results.' },
  { id: 'settings/connections', title: 'Connections', href: '/settings/connections', module: 'settings', description: 'Choose connected accounts and channels.' },
  { id: 'settings/team', title: 'Team', href: '/settings/team', module: 'settings', description: 'Manage people and access.' },
  { id: 'settings/account', title: 'Account', href: '/settings/account', module: 'settings', description: 'Your profile and preferences.' },
] as const;

export const MODULES: readonly { id: ModuleId; title: string; href: string }[] = [
  { id: 'home', title: 'Home', href: '/home' },
  { id: 'publishing', title: 'Publishing', href: '/publishing/posts' },
  { id: 'inbox', title: 'Inbox', href: '/inbox' },
  { id: 'analytics', title: 'Analytics', href: '/analytics' },
  { id: 'ads', title: 'Ads', href: '/ads' },
  { id: 'settings', title: 'Settings', href: '/settings/connections' },
];

export const pageFor = (pathname: string) => PAGES.find((page) => page.href === pathname);
