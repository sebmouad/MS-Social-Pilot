import { z } from 'zod';
import { entry } from '@/lib/config/entry';

export const SETTINGS_INVITATION_CONFIG = [
  entry({ key: 'settings.invitationsEnabled', group: 'Settings · Invitations', label: 'Workspace invitations enabled', kind: 'boolean', description: 'Allow invitation preview, acceptance, registration and new invitations. Turning this off disables outstanding invitation links; list and revoke remain available.', defaultValue: false, schema: z.boolean(), consumption: 'active' }),
  entry({ key: 'settings.invitationTtlHours', group: 'Settings · Invitations', label: 'Invitation lifetime (hours)', kind: 'number', description: 'Lifetime assigned to new workspace invitation links.', defaultValue: 168, schema: z.number().int().min(1).max(720), consumption: 'active' }),
  entry({ key: 'settings.invitationMaxPending', group: 'Settings · Invitations', label: 'Maximum pending invitations', kind: 'number', description: 'Maximum pending invitations in one workspace. Expired and accepted invitations do not count.', defaultValue: 100, schema: z.number().int().min(1).max(10000), consumption: 'active' }),
  entry({ key: 'settings.invitationPageLimit', group: 'Settings · Invitations', label: 'Invitation list size limit', kind: 'number', description: 'Maximum invitations returned in one directory read; larger directories fail rather than return a partial list.', defaultValue: 100, schema: z.number().int().min(1).max(1000), consumption: 'active' }),
  entry({ key: 'settings.invitationSessionMinutes', group: 'Settings · Invitations', label: 'Invitation preview session lifetime (minutes)', kind: 'number', description: 'Maximum lifetime of the encrypted browser cookie used to carry an invitation from preview to sign-in or registration.', defaultValue: 30, schema: z.number().int().min(1).max(1440), consumption: 'active' }),
] as const;
