import { z } from 'zod';
import { MODULES, PAGES } from '@/lib/product';

/** A deliberately small first slice of runtime options. Add a definition here
 * before exposing a new setting; forms and validation are derived from it. */
export const CONFIG_REGISTRY = [
  {
    key: 'auth.loginAttempts', group: 'Security', label: 'Sign-in attempts allowed', kind: 'number',
    description: 'Maximum password or verification attempts per account during one window.',
    defaultValue: 10, schema: z.number().int().min(1).max(1000),
  },
  {
    key: 'auth.loginWindowMinutes', group: 'Security', label: 'Sign-in attempt window', kind: 'number',
    description: 'Minutes before failed sign-in attempts reset.',
    defaultValue: 15, schema: z.number().int().min(1).max(1440),
  },
  {
    key: 'security.twoStep', group: 'Security', label: 'Two-step requirement', kind: 'text',
    description: 'Accepted values: admins, everyone, or off. Existing configured factors still require verification.',
    defaultValue: 'admins', schema: z.enum(['admins', 'everyone', 'off']),
  },
  {
    key: 'meta.graphVersion', group: 'Meta', label: 'Graph API version', kind: 'text',
    description: 'Version used by Meta integrations when they are connected.',
    defaultValue: 'v25.0', schema: z.string().regex(/^v\d+\.\d+$/, 'Use a version such as v25.0.'),
  },
  {
    key: 'meta.appSecret', group: 'Meta', label: 'Meta app secret', kind: 'secret',
    description: 'Encrypted at rest. The saved value is never returned by the configuration API.',
    defaultValue: '', schema: z.string().max(2048),
  },
  {
    key: 'jobs.enabled', group: 'Operations', label: 'Background jobs enabled', kind: 'boolean',
    description: 'Master availability switch for background work. The rebuilt screens do not yet consume this switch.',
    defaultValue: true, schema: z.boolean(),
  },
  {
    key: 'operations.supportEmail', group: 'Operations', label: 'Support email', kind: 'text',
    description: 'Contact address shown to operators; this is not yet wired into customer screens.',
    defaultValue: '', schema: z.union([z.literal(''), z.string().email()]),
  },
] as const;

export type ConfigKey = (typeof CONFIG_REGISTRY)[number]['key'];
export type ConfigKind = 'text' | 'secret' | 'boolean' | 'number';
export const CONFIG_BY_KEY = new Map(CONFIG_REGISTRY.map((entry) => [entry.key, entry]));

/** Availability choices are generated from the actual rebuild catalog. These
 * are descriptive until the product access layer consumes persisted switches. */
export const AVAILABILITY_CATALOG = {
  modules: MODULES.map(({ id, title }) => ({ id, title })),
  features: PAGES.map(({ id, title, module }) => ({ id, title, module })),
} as const;

export function safeConfigShape() {
  return CONFIG_REGISTRY.map(({ key, group, label, kind, description, defaultValue }) => ({
    key, group, label, kind, description, defaultValue,
  }));
}
