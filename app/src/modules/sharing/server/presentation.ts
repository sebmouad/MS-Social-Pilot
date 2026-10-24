import { runtimeConfig } from '@/server/config/store';
import { sharingPresentationSchema } from '../config';
import { safeUrl } from '../contracts';
import { sharingError } from './messages';

/** One validated Root policy for UI, HTTP and MCP. Invalid policy fails closed. */
export async function sharingPresentationPolicy() {
  const parsed = sharingPresentationSchema.safeParse(await runtimeConfig('sharing.presentationPolicy'));
  if (!parsed.success) throw await sharingError('unavailable', 'Sharing is temporarily unavailable. Try again later.');
  return parsed.data;
}
export function publicWorkspaceLogo(value: unknown, policy: Awaited<ReturnType<typeof sharingPresentationPolicy>>) {
  return policy.showWorkspaceLogo && typeof value === 'string' ? safeUrl(value, policy.logoUrlMaxCharacters, true) : null;
}
