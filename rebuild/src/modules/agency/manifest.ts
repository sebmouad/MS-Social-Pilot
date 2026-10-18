import type { ModuleManifest } from '../types';

/**
 * Agency is a person-level product module: it compares the workspaces one person owns or administers.
 * It has no background jobs. Not yet listed in `moduleManifests`; see docs/AGENCY.md for host wiring.
 */
export const agencyManifest = {
  id: 'agency',
  jobs: [],
  rootSettingsPrefixes: ['agency.'],
  rootSettingKeys: [],
  title: 'Agency',
  href: '/agency',
  pages: [
    { id: 'agency/overview', title: 'Workspaces', href: '/agency', description: 'Compare the workspaces you manage and see which need attention.' },
    { id: 'agency/clients', title: 'Clients', href: '/agency/clients', description: 'Client accounts and pending client invitations across your workspaces.' },
  ],
} as const satisfies ModuleManifest;
