import { z } from 'zod';
import { entry } from '@/lib/config/entry';

/** Self-service sign-up. Off by default: invitations stay the only way in until Root opens it. */
export const REGISTRATION_CONFIG = [
  entry({ key: 'auth.openRegistration', group: 'Security · registration', label: 'Open registration', kind: 'boolean', description: 'Let anyone create an account and their own workspace from the sign-up page. Needs working email so addresses can be verified.', defaultValue: false, schema: z.boolean(), consumption: 'active' }),
  entry({ key: 'auth.emailVerificationTtlMinutes', group: 'Security · registration', label: 'Email verification link lifetime (minutes)', kind: 'number', description: 'Maximum age of a one-use email verification link.', defaultValue: 1440, schema: z.number().int().min(15).max(10080), consumption: 'active' }),
] as const;
