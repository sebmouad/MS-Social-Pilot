import { z } from 'zod';
import { isDateKey } from '@/lib/calendar-dates';
import type { Policy } from '../config';
import type { Area } from '../contracts';
export const day = z.string().refine(isDateKey);
export const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export function schemas(policy: Policy) {
 const id = z.string().min(1).max(policy.maxIdentifier);
 const text = z.string().trim().min(1).max(policy.maxTitle);
 const targets = z.array(id).max(policy.maxTargets).transform(ids => [...new Set(ids)]);
 return {
  dates: z.object({ title: text, date: day, yearly: z.boolean(), targetIds: targets }).strict(),
  seasons: z.object({ name: text, startsOn: day, endsOn: day, targetIds: targets, rule: z.enum(['pause', 'shift', 'fewer', 'more']).refine(value => policy.enabledRules.includes(value)), shiftMinutes: z.number().int().min(-policy.maxShiftMinutes).max(policy.maxShiftMinutes), extraTimes: z.array(time).max(policy.maxExtraTimes) }).strict().refine(s => s.endsOn >= s.startsOn),
  notes: z.object({ label: text, day, targetId: id.nullable(), color: z.string().refine(c => policy.colors.includes(c as typeof policy.colors[number])) }).strict(),
  feeds: z.object({ name: text, targetIds: targets, groupId: id.nullable().default(null) }).strict(),
  trends: z.object({ keywords: z.array(z.string().trim().min(1).max(policy.maxKeywordLength)).max(policy.maxKeywords) }).strict(),
 };
}
export function actionSchema(area: Area, policy: Policy) {
 const id = z.string().min(1).max(policy.maxIdentifier);
 return z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('create'), data: schemas(policy)[area], confirmation: z.string() }).strict(),
  z.object({ operation: z.literal('update'), id, data: schemas(policy)[area], confirmation: z.string() }).strict(),
  z.object({ operation: z.literal('delete'), id, confirmation: z.string() }).strict(),
 ]);
}
export function confirmation(area: Area, operation: string, identity: string) {
 return `${operation.toUpperCase()} CALENDAR ${area.toUpperCase()} ${identity}`;
}
