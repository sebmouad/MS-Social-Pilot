import { z } from 'zod';
import { OperationError } from '@/lib/operation-error';
import { runtimeConfig } from '@/server/config/store';
import { prisma } from '@/server/data';
import { loadEntitlements, canUseFeature, entitledPlatformIds } from '@/server/entitlements';
import { loadPermissions } from '@/server/permissions/loader';
import { canAccessFeature } from '@/server/permissions';
import { assertWorkspaceNotPurging } from '@/server/data-control/guard';
import { loadAnalytics } from '../server/data';
import { analyticsDateRange } from '../server/comparison';
import { platformAnalytics } from '@/server/platforms/registry';
import type { Actor } from '../server/access';
import type { PostPerformance } from '@/server/platforms/host';

export const inputSchema = z.object({ start: z.string().optional(), end: z.string().optional(), filter: z.literal('1').optional(), channel: z.union([z.string(), z.array(z.string())]).optional(), page: z.coerce.number().int().min(1).max(100000).default(1), sort: z.string().min(1).max(200).regex(/^[^\u0000-\u001F\u007F]+$/).default('publishedAt'), direction: z.enum(['asc', 'desc']).default('desc') }).strict();
export type PostRow = PostPerformance & { channelId: string; channelName: string };
export function comparePosts(sort: string, direction: 'asc' | 'desc') {
  const value = (p: PostRow) => sort === 'publishedAt' ? p.publishedAt?.getTime() ?? null : p.measures.find(m => m.key === sort)?.value ?? null;
  return (a: PostRow, b: PostRow) => {
    const av = value(a), bv = value(b);
    return (av === null ? (bv === null ? 0 : 1) : bv === null ? -1 : (av - bv) * (direction === 'asc' ? 1 : -1)) || a.postId.localeCompare(b.postId) || a.channelId.localeCompare(b.channelId);
  };
}
export async function readPosts(actor: Actor, raw: unknown, cap?: number, exportMode = false) {
  const parsed = inputSchema.safeParse(raw);
  if (!parsed.success) throw new OperationError('invalid_request', 'Choose valid post filters.');
  const input = parsed.data;
  const [user, entitlements, permissions] = await Promise.all([prisma.user.findUnique({ where: { id: actor.userId }, select: { disabledAt: true } }), loadEntitlements(actor.userId, actor.workspaceId, { allowInstallationInspection: false }), loadPermissions(actor.userId, actor.workspaceId)]);
  if (!user || user.disabledAt || !entitlements || !permissions || !canUseFeature(entitlements, 'analytics/posts') || !canAccessFeature(permissions, 'analytics/posts')) throw new OperationError('forbidden', 'Post analytics access is unavailable.');
  await assertWorkspaceNotPurging(actor.workspaceId);
  const scope = permissions.pageScope.all ? actor.allowedChannelIds : permissions.pageScope.ids.filter(id => actor.allowedChannelIds === undefined || actor.allowedChannelIds.includes(id));
  const [size, days, maxDays, maxChannels] = await Promise.all([exportMode ? 'analytics.reportExportRows' : 'analytics.postsPageSize', 'analytics.defaultRangeDays', 'analytics.maxRangeDays', 'analytics.reportMaxChannels'].map(runtimeConfig));
  const pageSize = Math.min(Number(size), cap ?? Number(size));
  if (![pageSize, Number(days), Number(maxDays), Number(maxChannels)].every(n => Number.isSafeInteger(n) && n > 0)) throw new OperationError('unavailable', 'Analytics settings are unavailable.');
  let period;
  try { period = analyticsDateRange(input, { defaultDays: Number(days), maxDays: Number(maxDays) }); } catch { throw new OperationError('invalid_request', 'Choose a valid date range.'); }
  const catalog = await loadAnalytics(actor.workspaceId, [], period.range, scope, [], entitledPlatformIds(entitlements), { accountIds: [] });
  const options: typeof catalog.targets = [];
  for (const channel of catalog.targets) if (channel.providerId && (await platformAnalytics(channel.providerId))?.postPerformance) options.push(channel);
  const ids = input.channel === undefined ? [] : Array.isArray(input.channel) ? input.channel : [input.channel];
  if (ids.length && !input.filter) throw new OperationError('invalid_request', 'Choose channel filters.');
  if (ids.some(id => !options.some(c => c.id === id))) throw new OperationError('forbidden', 'A selected channel is unavailable.');
  const selected = input.filter ? options.filter(c => ids.includes(c.id)) : options;
  if (selected.length > Number(maxChannels)) throw new OperationError('invalid_request', 'Choose fewer channels.');
  const offset = (input.page - 1) * pageSize;
  const rows: PostRow[] = [];
  // Each channel contributes its first offset + pageSize + 1 rows to the global merge.
  for (const channel of selected) {
    const host = await platformAnalytics(channel.providerId!);
    const posts = await host!.postPerformance!({ workspaceId: actor.workspaceId, targetId: channel.id, ...period.range, limit: offset + pageSize + 1, sort: input.sort, direction: input.direction });
    rows.push(...posts.map(post => ({ ...post, channelId: channel.id, channelName: channel.name })));
  }
  rows.sort(comparePosts(input.sort, input.direction));
  const measures = [...new Map(rows.flatMap(row => row.measures.map(m => [m.key, { key: m.key, label: m.label, labelFr: m.labelFr }] as const))).values()];
  const items = rows.slice(offset, offset + pageSize);
  return { input, period, options, selectedIds: selected.map(c => c.id), measures, items, pageSize, nextPage: rows.length > offset + pageSize ? input.page + 1 : null };
}
export function postsCsv(rows: PostRow[], measures: Array<{ key: string; label: string; labelFr?: string }>, locale: 'en' | 'fr' = 'en') {
  const missing = locale === 'fr' ? 'Non disponible' : 'Not available';
  const cell = (value: unknown) => { const s = String(value ?? missing); return `"${(/^[=+\-@\t\r]/.test(s) ? "'" : '') + s.replaceAll('"', '""')}"`; };
  return [[...(locale === 'fr' ? ['Publication', 'Canal', 'Publié UTC', 'URL', 'Mesuré UTC'] : ['Post', 'Channel', 'Published UTC', 'URL', 'Measured UTC']), ...measures.map(m => locale === 'fr' ? m.labelFr ?? m.label : m.label)], ...rows.map(p => [p.text, p.channelName, p.publishedAt?.toISOString(), p.url, p.measuredAt?.toISOString(), ...measures.map(m => p.measures.find(v => v.key === m.key)?.value)])].map(row => row.map(cell).join(',')).join('\r\n');
}

/** Complete bounded export: refuse oversized periods rather than silently truncate. */
export async function exportPosts(actor: Actor, raw: unknown, locale: 'en' | 'fr' = 'en') {
  const input = inputSchema.safeParse(raw);
  if (!input.success) throw new OperationError('invalid_request', 'Choose valid post filters. / Choisissez des filtres valides.');
  const data = await readPosts(actor, { ...input.data, page: 1 }, undefined, true);
  if (data.nextPage !== null) throw new OperationError('invalid_request', 'Choose fewer channels or a shorter period to export all posts. / Choisissez moins de canaux ou une période plus courte pour tout exporter.');
  return postsCsv(data.items, data.measures, locale);
}
