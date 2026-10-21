import { defaultAnalyticsError } from '@/modules/analytics/error-copy';
import { localizeAnalyticsError } from '@/modules/analytics/server/error-copy';
import { errorCopyDefaults } from '@/modules/analytics/error-copy';
import { analyticsError } from '@/modules/analytics/server/error-copy';
import { OperationError } from '@/lib/operation-error';
import { prisma } from '@/server/data';
import { runtimeConfig } from '@/server/config/store';
import { withWorkspaceOperation } from '@/server/data-control/guard';
import { readAnalyticsSnapshot } from '../../server/read';
import { audit, authorize, bad, type Actor } from '../../server/access';
import { PIN_PREFIX, pinActionSchema, pinConfirmation, type PinnedMetricView } from '../contracts';

async function maxPins() {
  const value = Number(await runtimeConfig('analytics.pins.maxPerUser'));
  if (!Number.isSafeInteger(value) || value < 1 || value > 50) throw await analyticsError('unavailable', "Pinned metrics are temporarily unavailable.");
  return value;
}
const ownPins = (stored: readonly string[]) => stored.filter(item => item.startsWith(PIN_PREFIX)).map(item => item.slice(PIN_PREFIX.length));
async function storedPins(userId: string) {
  const rows = await prisma.$queryRaw<Array<{ pinned: string[] | null }>>`SELECT "pinnedMetrics" AS pinned FROM users WHERE id = ${userId}`;
  return rows[0]?.pinned ?? [];
}

/** Personal pinned metrics resolved against the current scoped snapshot. A pin whose metric is not available now is shown as unknown, never as zero. */
export async function readPinnedMetrics(actor: Actor, input: unknown = {}) {
  try {
  await authorize(actor, 'analytics/pins', 'read');
  const [snapshot, stored, max] = await Promise.all([readAnalyticsSnapshot(actor, input ?? {}, { feature: 'analytics/pins', allowedChannelIds: actor.allowedChannelIds }), storedPins(actor.userId), maxPins()]);
  const keys = ownPins(stored);
  const byKey = new Map(snapshot.allMetrics.map(metric => [metric.key, metric]));
  const pins: PinnedMetricView[] = keys.map(key => {
    const metric = byKey.get(key);
    if (!metric) return { key, label: key, sourceLabel: '', unit: 'count', kind: 'unknown', resourceKind: null, state: 'unavailable', total: null, coverage: null, available: null, latestAt: null, comparison: null };
    const cmp = snapshot.comparisons[key];
    return {
      key, label: metric.label, sourceLabel: metric.sourceLabel, unit: metric.unit, kind: metric.kind, resourceKind: metric.resourceKind, state: 'available', total: metric.total,
      ...(metric.displayTotal ? { displayTotal: metric.displayTotal } : {}), aggregationLabel: metric.aggregationLabel, ...(metric.aggregationNote ? { aggregationNote: metric.aggregationNote } : {}),
      coverage: metric.coverage, available: metric.available, latestAt: metric.latestAt,
      comparison: cmp ? { status: cmp.status, previous: cmp.previous, delta: cmp.delta, percent: cmp.percent } : null,
    };
  });
  const pinned = new Set(keys);
  const result = {
    ok: true as const, period: snapshot.period, pins, max,
    pinnable: snapshot.allMetrics.filter(metric => metric.kind !== 'breakdown').map(m => ({ key: m.key, label: m.label, sourceLabel: m.sourceLabel, pinned: pinned.has(m.key) })),
  };
  if (actor.maxResultItems !== undefined && (!Number.isSafeInteger(actor.maxResultItems) || actor.maxResultItems < 1 || result.pins.length + result.pinnable.length > actor.maxResultItems)) {
    throw await analyticsError('invalid_request', "The pinned metrics result exceeds the current MCP limit. Narrow the Analytics filters.");
  }
  return result;

  } catch (error) { throw await localizeAnalyticsError(error); }
}

export async function changePinnedMetrics(actor: Actor, input: unknown) {
  try {
  const parsed = pinActionSchema.safeParse(input); if (!parsed.success) throw bad();
  const value = parsed.data;
  const expected = value.action === 'reorder' ? pinConfirmation.reorder(value.keys.length) : pinConfirmation[value.action](value.key);
  if (value.confirmation !== expected) throw bad();
  await authorize(actor, 'analytics/pins', 'read');
  const max = await maxPins();
  if (value.action === 'reorder' && (new Set(value.keys).size !== value.keys.length || value.keys.length > max)) throw bad();
  if (value.action === 'pin') {
    // Only a non-breakdown metric visible to this person, under their current channel scope, can be pinned.
    const catalog = await readAnalyticsSnapshot(actor, {}, { feature: 'analytics/pins', allowedChannelIds: actor.allowedChannelIds });
    const metric = catalog.allMetrics.find(item => item.key === value.key);
    if (!metric || metric.kind === 'breakdown') throw bad( errorCopyDefaults["Choose a single-value metric that is available to you."].en);
  }
  return withWorkspaceOperation(actor.workspaceId, () => prisma.$transaction(async tx => {
    const rows = await tx.$queryRaw<Array<{ pinned: string[] | null; disabledAt: Date | null }>>`SELECT "pinnedMetrics" AS pinned, "disabledAt" FROM users WHERE id = ${actor.userId} FOR UPDATE`;
    const row = rows[0];
    if (!row || row.disabledAt) throw await analyticsError('unauthorized', "Sign in with an active account to use Analytics.");
    const stored = row.pinned ?? [];
    const others = stored.filter(item => !item.startsWith(PIN_PREFIX));
    const current = ownPins(stored);
    let next: string[];
    if (value.action === 'pin') {
      if (current.includes(value.key)) return { ok: true as const, action: value.action, key: value.key, unchanged: true as const, count: current.length };
      if (current.length >= max) throw new OperationError('conflict', defaultAnalyticsError('You can pin up to {0} metrics. Unpin one first.', max));
      next = [...current, value.key];
    } else if (value.action === 'unpin') {
      if (!current.includes(value.key)) return { ok: true as const, action: value.action, key: value.key, unchanged: true as const, count: current.length };
      next = current.filter(item => item !== value.key);
    } else {
      // A reorder may only rearrange existing pins (and drop some); it cannot introduce unverified keys.
      if (!value.keys.every(item => current.includes(item))) throw bad( errorCopyDefaults["Reorder only metrics that are currently pinned."].en);
      next = value.keys;
    }
    const written = [...others, ...next.map(item => PIN_PREFIX + item)];
    const changed = await tx.$executeRaw`UPDATE users SET "pinnedMetrics" = ${written}::text[] WHERE id = ${actor.userId}`;
    if (!changed) throw await analyticsError('unavailable', "Your pinned metrics could not be saved.");
    await audit(tx, actor, 'analytics.pins_changed', { action: value.action, ...(value.action === 'reorder' ? { count: next.length } : { key: value.key }) });
    return { ok: true as const, action: value.action, ...(value.action === 'reorder' ? {} : { key: value.key }), count: next.length };
  }));

  } catch (error) { throw await localizeAnalyticsError(error); }
}
