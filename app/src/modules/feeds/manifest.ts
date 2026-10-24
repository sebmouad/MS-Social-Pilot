import { FEEDS_CONFIG } from './config';

/**
 * Content feeds are a feature of the Publishing product module: new articles become Publishing posts
 * and access follows Publishing's post rules. Publishing's manifest spreads these declarations so the
 * feeds feature owns its navigation entry, Root setting keys and worker job; there is no separate module id.
 */
export const FEEDS_FEATURE_ID = 'publishing/feeds' as const;

export const FEEDS_PAGES = [
  { id: FEEDS_FEATURE_ID, title: 'Content feeds', href: '/content/feeds', description: 'Turn new articles from a website feed into posts for your channels.' },
] as const;

/** Every Root key of this feature (checked against FEEDS_CONFIG by tests/feeds-module.test.ts). */
export const FEEDS_ROOT_KEYS = FEEDS_CONFIG.map(entry => entry.key);

export const FEEDS_JOBS = [
  { name: 'feedsPoll', label: 'Content feed reading', configKey: 'feeds.autoCheck.schedule' },
] as const;
