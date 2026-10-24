'use server';
import { headers } from 'next/headers';
import { requireViewer } from '@/server/context';
import { OperationError } from '@/lib/operation-error';
import { AREAS, FEATURES, type Area, type Locale } from '../contracts';
import { settings } from '../server/settings';
import { changeCalendarEntry } from '../server/service';
export async function calendarAction(area: Area, raw: unknown) {
 const locale: Locale = /^\s*fr\b/i.test((await headers()).get('accept-language') ?? '') ? 'fr' : 'en';
 const { copy } = await settings(locale);
 try {
  if (!AREAS.includes(area)) throw new OperationError('invalid_request', copy.invalid);
  const viewer = await requireViewer({ feature: FEATURES[area], channelScoped: true });
  const receipt = await changeCalendarEntry({ userId: viewer.user.id, workspaceId: viewer.workspaceId, locale }, area, raw);
  return { ok: true as const, receipt };
 } catch (error) { return { ok: false as const, error: error instanceof OperationError ? error.message : copy.failure, uncertain: !(error instanceof OperationError) }; }
}
