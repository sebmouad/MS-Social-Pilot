import { runtimeConfig } from '@/server/config/store';
import { policySchema } from '../config';
import { copySchema } from '../copy';
import type { Locale } from '../contracts';
/** Deliberately no silent fallback for an uninstalled module: the integrator must register the two entries. */
export async function settings(locale: Locale = 'en') {
 const [policy, copy] = await Promise.all([runtimeConfig('calendarExtras.policy'), runtimeConfig('calendarExtras.customerCopy')]);
 return { policy: policySchema.parse(policy), copy: copySchema.parse(copy)[locale] };
}
