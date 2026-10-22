import { z } from 'zod';
import { OperationError } from '@/lib/operation-error';
import { loadErrorsPolicy, recordError } from './recorder';

/** Signed-in person -> request times inside the current window. In memory on purpose: a brake, not access control. */
const recent = new Map<string, number[]>();

export type ClientReportResult = { recorded: boolean; reason?: 'disabled' | 'rate_limited' | 'not_stored' };

/**
 * The one service behind the browser error report endpoint. Only a signed-in person's browser may report,
 * a few at a time, so the endpoint cannot be used to fill the table. Bodies are validated against Root limits.
 * There is no MCP tool: this is a telemetry sink for the app's own pages, not a customer capability.
 */
export async function reportClientError(actor: { userId: string }, input: unknown, now = Date.now()): Promise<ClientReportResult> {
  if (!actor.userId) throw new OperationError('unauthorized', 'Sign in to an authorized workspace.');
  const policy = await loadErrorsPolicy();
  if (!policy['errors.recordingEnabled'] || !policy['errors.clientReportsEnabled']) return { recorded: false, reason: 'disabled' };
  const body = z.object({
    name: z.string().max(policy['errors.nameMaxCharacters']).default('Error'),
    message: z.string().max(policy['errors.clientMessageMaxCharacters']),
    stack: z.string().max(policy['errors.clientStackMaxCharacters']).optional(),
    path: z.string().max(policy['errors.clientPathMaxCharacters']).optional(),
  }).strict().safeParse(input);
  if (!body.success) throw new OperationError('invalid_request', 'The error report was not valid.');

  const windowMs = policy['errors.clientReportsWindowSeconds'] * 1000;
  const times = (recent.get(actor.userId) ?? []).filter(at => now - at < windowMs);
  if (times.length >= policy['errors.clientReportsPerWindow']) return { recorded: false, reason: 'rate_limited' };
  if (recent.size >= policy['errors.clientTrackedPeopleMax']) recent.delete(recent.keys().next().value as string);
  recent.set(actor.userId, [...times, now]);

  const error = Object.assign(new Error(body.data.message), { name: body.data.name, stack: body.data.stack });
  const recorded = await recordError({ source: 'browser', error, location: body.data.path ?? null });
  return recorded ? { recorded } : { recorded, reason: 'not_stored' };
}

export function resetClientReportLimitsForTests() { recent.clear(); }
