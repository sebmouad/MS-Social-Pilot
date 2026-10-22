'use server';

import { redirect } from 'next/navigation';
import { requireViewer } from '@/server/context';
import { operationFailure } from '@/lib/operation-error';
import { createApiToken, revokeApiToken } from '@/modules/integrations/server/tokens';
import { authorizeConnector } from '@/modules/integrations/server/oauth';

export type ActionResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };
async function actor() {
  const viewer = await requireViewer({ feature: 'settings/mcp', channelScoped: true, write: true });
  return { userId: viewer.user.id, workspaceId: viewer.workspaceId };
}
const fail = (error: unknown, fallback: string): { ok: false; error: string } => ({ ok: false, error: operationFailure(error, fallback).error });

export async function createKeyAction(input: unknown): Promise<ActionResult<{ id: string; token: string; prefix: string; notice: string }>> {
  try {
    const made = await createApiToken(await actor(), input);
    return { ok: true, id: made.id, token: made.token, prefix: made.prefix, notice: made.tokenNotice };
  } catch (error) { return fail(error, 'The key could not be created.'); }
}
export async function revokeKeyAction(input: unknown): Promise<ActionResult<{ webhooksDisabled: number }>> {
  try { const done = await revokeApiToken(await actor(), input); return { ok: true, webhooksDisabled: done.webhooksDisabled }; }
  catch (error) { return fail(error, 'The key could not be revoked.'); }
}
/** Consent from the connect page. On success the browser is sent to the connector's registered address. */
export async function authorizeConnectorAction(input: unknown): Promise<ActionResult> {
  let target: string;
  try { target = (await authorizeConnector(await actor(), input)).redirectTo; }
  catch (error) { return fail(error, 'The connection could not be authorized.'); }
  redirect(target);
}
