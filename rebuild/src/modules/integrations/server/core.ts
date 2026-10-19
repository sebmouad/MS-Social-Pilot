import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Prisma } from '../../../../generated/client';
import { OperationError } from '@/lib/operation-error';
import { prisma } from '@/server/data';
import { runtimeConfig } from '@/server/config/store';
import { canUseFeature, loadEntitlements } from '@/server/entitlements';
import { canAccessFeature } from '@/server/permissions';
import { loadPermissions } from '@/server/permissions/loader';
import { assertWorkspaceNotPurging, withWorkspaceOperation } from '@/server/data-control/guard';
import { INTEGRATIONS_CONFIG, INTEGRATIONS_SWITCHES, LIMIT_FIELDS, type IntegrationsLimits } from '../config';
import type { IntegrationsActor } from '../contracts';
import { WEBHOOKS_FEATURE_ID } from '../manifest';

export type Tx = Prisma.TransactionClient;
export const bad = (message = 'Check the details and confirm the exact action.') => new OperationError('invalid_request', message);
export const unavailable = () => new OperationError('unavailable', 'This is temporarily unavailable. Try again later.');
export const notFound = (what = 'item') => new OperationError('not_found', `This ${what} is unavailable in the current workspace.`);
export function parse<S extends z.ZodTypeAny>(schema: S, input: unknown, message?: string): z.output<S> {
  const result = schema.safeParse(input);
  if (!result.success) throw bad(message);
  return result.data;
}
export function exact(actual: string, expected: string) { if (actual !== expected) throw bad('Type the exact confirmation shown to continue.'); }
/** Anything that is not an explicit product failure becomes one safe message; internals never reach callers. */
export async function protect<T>(operation: Promise<T>, fallback = 'The action could not be confirmed. Refresh and check the current state before trying again.'): Promise<T> {
  try { return await operation; } catch (error) { if (error instanceof OperationError) throw error; throw new OperationError('upstream_failure', fallback); }
}

export type Runtime = { limits: IntegrationsLimits; retryDelaysSeconds: number[]; hostAllowlist: string[]; enabled: { api: boolean; webhooks: boolean } };

/** Live Root-managed values. Any missing or invalid value makes the feature unavailable instead of guessing. */
export async function runtime(): Promise<Runtime> {
  try {
    const [values, workspaceTimeout] = await Promise.all([Promise.all(INTEGRATIONS_CONFIG.map(item => runtimeConfig(item.key))), runtimeConfig('data.workspaceOperationTimeoutMs')]);
    const limits: Record<string, number> = {}; const others: Record<string, unknown> = {};
    INTEGRATIONS_CONFIG.forEach((item, index) => {
      const parsed = item.schema.safeParse(values[index]);
      if (!parsed.success) throw unavailable();
      const field = LIMIT_FIELDS[item.key];
      if (field) limits[field] = parsed.data as number; else others[item.key] = parsed.data;
    });
    const l = limits as unknown as IntegrationsLimits;
    if (typeof workspaceTimeout !== 'number' || l.transactionTimeoutMs + l.transactionMaxWaitMs >= workspaceTimeout) throw unavailable();
    return {
      limits: l, retryDelaysSeconds: others['integrations.webhooks.retryDelaysSeconds'] as number[], hostAllowlist: others['integrations.webhooks.hostAllowlist'] as string[],
      enabled: { api: others[INTEGRATIONS_SWITCHES.api] === true, webhooks: others[INTEGRATIONS_SWITCHES.webhooks] === true },
    };
  } catch (error) { if (error instanceof OperationError) throw error; throw unavailable(); }
}
export function requireEnabled(rt: Runtime, area: keyof Runtime['enabled']) {
  if (!rt.enabled[area]) throw new OperationError('unavailable', 'This capability is turned off for this installation.');
}

export type Authority = { role: string; actor: IntegrationsActor };
/**
 * Webhooks belong to workspace owners and admins holding the Webhooks settings grant. The account, membership, plan and grants
 * are re-read on every call, so a removed, disabled or demoted person is refused even with a stale session or key.
 */
export async function authorize(actor: IntegrationsActor, write: boolean): Promise<Authority> {
  if (!actor?.userId || !actor.workspaceId) throw new OperationError('unauthorized', 'Sign in with an active workspace account.');
  const [user, membership, entitlements, permissions] = await Promise.all([
    prisma.user.findUnique({ where: { id: actor.userId }, select: { disabledAt: true } }),
    prisma.membership.findUnique({ where: { userId_workspaceId: { userId: actor.userId, workspaceId: actor.workspaceId } }, select: { role: true } }),
    loadEntitlements(actor.userId, actor.workspaceId, { allowInstallationInspection: false }),
    loadPermissions(actor.userId, actor.workspaceId),
  ]);
  if (!user || user.disabledAt || !membership) throw new OperationError('unauthorized', 'Your active workspace access changed. Sign in again to continue.');
  const denied = () => new OperationError('forbidden', 'Webhooks are managed by workspace owners and admins.');
  if (membership.role !== 'owner' && membership.role !== 'admin') throw denied();
  if (!entitlements || entitlements.workspaceId !== actor.workspaceId || !permissions) throw denied();
  if (!canUseFeature(entitlements, WEBHOOKS_FEATURE_ID) || !canAccessFeature(permissions, WEBHOOKS_FEATURE_ID, write ? 'write' : 'read')) throw denied();
  await assertWorkspaceNotPurging(actor.workspaceId);
  return { role: membership.role, actor };
}

/** Workspace operation + advisory lock; membership/user rows are re-read under lock so a removed or demoted caller cannot slip a write through. */
export async function transact<T>(actor: IntegrationsActor, limits: IntegrationsLimits, fn: (tx: Tx) => Promise<T>, lockName = 'webhooks'): Promise<T> {
  return withWorkspaceOperation(actor.workspaceId, () => prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify([`integrations:${lockName}`, actor.workspaceId])}, 0))::text`;
    const rows = await tx.$queryRaw<Array<{ role: string; disabledAt: Date | null }>>`SELECT m.role::text AS role, u."disabledAt" FROM memberships m JOIN users u ON u.id = m."userId" WHERE m."userId" = ${actor.userId} AND m."workspaceId" = ${actor.workspaceId} FOR UPDATE OF m, u`;
    const state = rows[0];
    if (!state || state.disabledAt) throw new OperationError('unauthorized', 'Your active workspace access changed. Sign in again to continue.');
    if (state.role !== 'owner' && state.role !== 'admin') throw new OperationError('forbidden', 'Webhooks are managed by workspace owners and admins.');
    return fn(tx);
  }, { timeout: limits.transactionTimeoutMs, maxWait: limits.transactionMaxWaitMs }));
}
export async function audit(tx: Tx, actor: IntegrationsActor, action: string, detail: object) {
  await tx.$executeRaw`INSERT INTO activity_logs (id, "workspaceId", "actorId", action, detail, "createdAt") VALUES (${randomUUID()}, ${actor.workspaceId}, ${actor.userId}, ${action}, ${JSON.stringify(detail)}::jsonb, NOW())`;
}
export const pageOffset = (page: number | undefined, size: number) => ((page ?? 1) - 1) * size;
