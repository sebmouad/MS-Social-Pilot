/**
 * History is a feature of the Settings product module: workspace owners and admins read the activity log and the
 * email log next to the other workspace controls. Settings' manifest spreads these declarations so the module owns
 * its navigation entry and its Root setting keys; there is no separate module id.
 *
 * The same folder also serves the public site (help, pricing, privacy, terms, status, changelog), the Root changelog
 * editor and the health probe. Those are installation-level and carry no workspace feature.
 */
export const HISTORY_FEATURE_ID = 'settings/history' as const;

export const HISTORY_PAGES = [
  { id: HISTORY_FEATURE_ID, title: 'History', href: '/settings/history', description: 'See who did what in this workspace and which emails were sent.' },
] as const;

/** Root setting namespace owned by Settings for the History feature. Public-site, error and health keys are shared infrastructure. */
export const HISTORY_ROOT_PREFIX = 'history.' as const;
