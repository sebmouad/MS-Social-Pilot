import type { Prisma } from '../../../../generated/client';
import { OperationError } from '@/lib/operation-error';
import { runtimeConfig } from '@/server/config/store';
import { parseScheduleMode, SCHEDULE_MODES, type ScheduleMode } from '@/modules/publishing/remote-scheduling';

/** Where each destination's schedule waits, keyed by destination (target) id. */
export type DestinationScheduleModes = Record<string, ScheduleMode>;
export type ResolvedScheduleModes = { postMode: ScheduleMode; byTarget: Map<string, ScheduleMode> };

/** Strictly parse the optional per-destination map; a malformed map is refused rather than partly applied. */
export function parseDestinationScheduleModes(value: unknown): DestinationScheduleModes | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) throw new OperationError('invalid_request', 'Choose a scheduling place for each destination.');
  const result: DestinationScheduleModes = {};
  for (const [targetId, mode] of Object.entries(value)) {
    const parsed = typeof mode === 'string' ? parseScheduleMode(mode) : undefined;
    if (!targetId || targetId.length > 200 || !parsed) throw new OperationError('invalid_request', `Choose ${SCHEDULE_MODES.join(' or ')} for each destination.`);
    result[targetId] = parsed;
  }
  return result;
}

/** The composer submits the per-destination overrides as JSON; an empty value or an empty object means "no overrides". */
export function parseDestinationScheduleModesJson(raw: unknown): DestinationScheduleModes | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  if (typeof raw !== 'string') throw new OperationError('invalid_request', 'Choose a scheduling place for each destination.');
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new OperationError('invalid_request', 'Choose a scheduling place for each destination.'); }
  const parsed = parseDestinationScheduleModes(value);
  return parsed && Object.keys(parsed).length ? parsed : undefined;
}

/** Requested mode, falling back to the Root default; platform holding is refused outright when Root withdrew the choice. */
export async function effectiveScheduleMode(requested: ScheduleMode | undefined): Promise<ScheduleMode> {
  parseScheduleMode(requested);
  const offered = await runtimeConfig('publishing.remoteScheduling.offered') === true;
  if (requested === 'remote' && !offered) throw new OperationError('invalid_request', 'Platform-held scheduling is not available. Choose application scheduling.');
  if (requested) return requested;
  return offered && await runtimeConfig('publishing.remoteScheduling.defaultMode') === 'remote' ? 'remote' : 'application';
}

/**
 * Resolve every destination's mode: its own override, else the post-level choice, else the Root default. Overrides naming a
 * destination that is not on the post are refused, and a platform-held override is refused when Root withdrew the choice.
 */
export async function resolveScheduleModes(targetIds: readonly string[], postLevel: ScheduleMode | undefined, overrides?: DestinationScheduleModes): Promise<ResolvedScheduleModes> {
  const postMode = await effectiveScheduleMode(postLevel);
  const known = new Set(targetIds);
  for (const [targetId, mode] of Object.entries(overrides ?? {})) {
    if (!known.has(targetId)) throw new OperationError('invalid_request', 'A scheduling choice names a destination that is not on this post.');
    if (mode === 'remote') await effectiveScheduleMode('remote');
  }
  return { postMode, byTarget: new Map(targetIds.map(id => [id, overrides?.[id] ?? postMode])) };
}

/** Modes for a post a system job schedules: never throws; if the choice cannot be honoured every destination stays with the application. */
export async function systemScheduleModes(targetIds: readonly string[], preferred?: DestinationScheduleModes): Promise<Map<string, ScheduleMode>> {
  const scoped = preferred ? Object.fromEntries(Object.entries(preferred).filter(([id]) => targetIds.includes(id))) : undefined;
  try { return (await resolveScheduleModes(targetIds, undefined, scoped)).byTarget; }
  catch { return new Map(targetIds.map(id => [id, 'application' as const])); }
}

export const anyRemote = (modes: ReadonlyMap<string, ScheduleMode>) => [...modes.values()].includes('remote');
/** Post-level summary reported to callers: platform-held as soon as any destination is. */
export const summaryMode = (modes: ReadonlyMap<string, ScheduleMode>): ScheduleMode => anyRemote(modes) ? 'remote' : 'application';

/**
 * Store the choice. Every destination gets an explicit value (so a later change of the post-level choice cannot silently move
 * it); the legacy post column records "platform-held" if any destination is, which is what triggers the platform hand-off.
 */
export async function storeScheduleModes(tx: Prisma.TransactionClient, workspaceId: string, postId: string, modes: ReadonlyMap<string, ScheduleMode>) {
  await tx.$executeRaw`UPDATE posts SET "publishMode" = ${anyRemote(modes) ? 'native' : 'worker'}::"PublishMode" WHERE id = ${postId} AND "workspaceId" = ${workspaceId}`;
  for (const [targetId, mode] of modes) {
    await tx.$executeRaw`UPDATE post_targets SET "scheduleMode" = ${mode} WHERE "postId" = ${postId} AND "targetId" = ${targetId}`;
  }
}

/** Back to a draft: the post returns to application scheduling and every destination forgets its own choice. */
export async function clearScheduleModes(tx: Prisma.TransactionClient, workspaceId: string, postId: string) {
  await tx.$executeRaw`UPDATE posts SET "publishMode" = 'worker'::"PublishMode" WHERE id = ${postId} AND "workspaceId" = ${workspaceId}`;
  await tx.$executeRaw`UPDATE post_targets SET "scheduleMode" = NULL WHERE "postId" = ${postId}`;
}

/** A destination's stored mode; null (legacy rows) follows the post-level choice, which the caller has already read as "platform-held". */
export const destinationMode = (stored: string | null | undefined, postLevel: ScheduleMode): ScheduleMode => stored === 'remote' || stored === 'application' ? stored : postLevel;
