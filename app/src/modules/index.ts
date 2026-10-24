import { agencyManifest } from './agency/manifest';
import { studioManifest } from './studio/manifest';
import { adsManifest } from './ads/manifest';
import { analyticsManifest } from './analytics/manifest';
import { homeManifest } from './home/manifest';
import { inboxManifest } from './inbox/manifest';
import { publishingManifest } from './publishing/manifest';
import { settingsManifest } from './settings/manifest';
import { tasksManifest } from './tasks/manifest';

/** Customer module catalog. Internal Root tools intentionally live outside it. */
export const moduleManifests = [
  homeManifest,
  publishingManifest,
  studioManifest,
  inboxManifest,
  analyticsManifest,
  adsManifest,
  tasksManifest,
  agencyManifest,
  settingsManifest,
] as const;

export type ManifestModuleId = (typeof moduleManifests)[number]['id'];
export type ManifestFeatureId = (typeof moduleManifests)[number]['pages'][number]['id'];
