import { z } from 'zod';
import { OperationError } from '@/lib/operation-error';
import { prisma } from '@/server/data';
import { loadEntitlements, canUseFeature, entitledPlatformIds } from '@/server/entitlements';
import { loadPermissions } from '@/server/permissions/loader';
import { canAccessFeature } from '@/server/permissions';
import { assertWorkspaceNotPurging } from '@/server/data-control/guard';
import { runtimeConfig } from '@/server/config/store';
import { getAdsAccounts, getAdsDataset } from '@/modules/ads/server/queries';
import { normalizeAdsDailyRow } from '@/modules/ads/report-data';
import { analyticsDateRange } from '../server/comparison';
import { platformAds } from '@/server/platforms/registry';
import type { Actor } from '../server/access';
import { aggregateObjects, adObjectsCsv, sortAdObjects, AD_OBJECT_SORTS, type Observation } from './aggregate';

const id = z.string().min(1).max(200).regex(/^[^\u0000-\u001f\u007f]+$/);
const optionalId = z.preprocess(value => value === '' ? undefined : value, id.optional());
const optionalDate = z.preprocess(value => value === '' ? undefined : value, z.string().optional());
const schema = z.object({ start: optionalDate, end: optionalDate, accountId: optionalId, level: z.enum(['campaign', 'adset', 'ad']).default('campaign'), parentId: optionalId, objectId: optionalId, page: z.union([z.number().int().positive().max(100000), z.string().regex(/^[1-9]\d{0,5}$/).transform(Number).refine(value => value <= 100000)]).default(1), sort: z.enum(AD_OBJECT_SORTS).default('name'), direction: z.enum(['asc', 'desc']).default('asc'), format: z.enum(['json', 'csv']).default('json'), locale: z.enum(['en', 'fr']).default('en') }).strict();
const bad = () => new OperationError('invalid_request', 'Choose valid ad-object filters or a shorter period. / Choisissez des filtres valides ou une période plus courte.');
const forbidden = () => new OperationError('forbidden', 'Ad-object analytics access is unavailable. / L’analyse des objets publicitaires est indisponible.');

/** All entry points recheck current membership, entitlement and selected resource visibility here. No provider I/O. */
export async function readAdObjects(actor: Actor, raw: unknown = {}) {
  const parsed = schema.safeParse(raw); if (!parsed.success) throw bad();
  const input = parsed.data;
  if ((input.parentId && (!input.accountId || input.level === 'campaign')) || (input.objectId && !input.accountId)) throw bad();
  if (!actor.userId || !actor.workspaceId) throw forbidden();
  const [user, membership, entitlements, permissions] = await Promise.all([
    prisma.user.findUnique({ where: { id: actor.userId }, select: { disabledAt: true } }),
    prisma.membership.findUnique({ where: { userId_workspaceId: { userId: actor.userId, workspaceId: actor.workspaceId } }, select: { role: true } }),
    loadEntitlements(actor.userId, actor.workspaceId, { allowInstallationInspection: false }), loadPermissions(actor.userId, actor.workspaceId),
  ]);
  if (!user || user.disabledAt || !membership || !entitlements || entitlements.workspaceId !== actor.workspaceId || !permissions || !canUseFeature(entitlements, 'analytics/ads') || !canAccessFeature(permissions, 'analytics/ads', 'read')) throw forbidden();
  await assertWorkspaceNotPurging(actor.workspaceId);
  const granted = permissions.pageScope.all ? undefined : permissions.pageScope.ids;
  // An independent Ads grant must not be narrowed by an API key's unrelated channel selection.
  const ceiling = actor.adAccountTargetScope === undefined ? actor.allowedChannelIds : actor.adAccountTargetScope.all ? undefined : actor.adAccountTargetScope.ids;
  const targetIds = ceiling === undefined ? granted : ceiling.filter(value => granted === undefined || granted.includes(value));
  const [defaultDays, maxDays, pageSize, maxRows, maxBytes] = (await Promise.all([
    runtimeConfig('analytics.defaultRangeDays'), runtimeConfig('analytics.maxRangeDays'), runtimeConfig('analytics.adObjects.pageSize'), runtimeConfig('analytics.adObjects.maxRows'), runtimeConfig('analytics.adObjects.maxBytes'),
  ])).map(Number);
  if ([defaultDays, maxDays, pageSize, maxRows, maxBytes, ...(actor.maxResultItems === undefined ? [] : [actor.maxResultItems])].some(value => !Number.isSafeInteger(value) || value < 1)) throw new OperationError('unavailable', 'Analytics settings are unavailable. / Les paramètres sont indisponibles.');
  let period;
  try { period = analyticsDateRange(input, { defaultDays: Math.min(defaultDays, maxDays), maxDays }); } catch { throw bad(); }
  const providers = entitledPlatformIds(entitlements);
  const accounts = await getAdsAccounts(actor.workspaceId, targetIds, providers, actor.allowedAdAccountIds);
  if (input.accountId && !accounts.some(account => account.id === input.accountId)) throw forbidden();
  const selected = accounts.filter(account => !input.accountId || account.id === input.accountId);
  const dataset = await getAdsDataset(actor.workspaceId, { period: 'custom', since: period.range.from, until: new Date(period.range.to.getTime() + 1), accountId: input.accountId ?? null }, targetIds, providers, { levels: ['campaign', 'adset', 'ad'], allowedAdAccountIds: actor.allowedAdAccountIds });
  if (dataset.insights.length > maxRows) throw bad();
  // Fail closed if selection or connection state changed between catalog and data reads.
  if (selected.some(account => !account.socialAccount)) throw forbidden();
  const providerByAccount = new Map(selected.map(account => [account.id, account.socialAccount!.provider]));
  if (dataset.insights.some(row => !providerByAccount.has(row.adAccountId))) throw forbidden();
  const hosts = new Map(await Promise.all([...new Set(providerByAccount.values())].map(async provider => [provider, await platformAds(provider)] as const)));
  const observations: Observation[] = dataset.insights.map(row => {
    const daily = normalizeAdsDailyRow(row);
    const host = hosts.get(providerByAccount.get(row.adAccountId)!);
    let parentId: string | null = null;
    if (row.level === 'adset' || row.level === 'ad') {
      try { const parent = host?.parentObjectId?.({ level: row.level, fields: row.fields }); if (parent && id.safeParse(parent).success) parentId = parent; } catch { /* Unknown lineage is explicit coverage, never a guessed association. */ }
    }
    return { ...daily, parentId };
  });
  const requestedDays = Math.round((period.range.to.getTime() + 1 - period.range.from.getTime()) / 86400000);
  const all = aggregateObjects(observations, requestedDays);
  if (input.parentId && !all.some(item => item.accountId === input.accountId && item.level === (input.level === 'adset' ? 'campaign' : 'adset') && item.objectId === input.parentId)) throw new OperationError('not_found', 'The parent has no stored data in this period. / Le parent ne contient aucune donnée pour cette période.');
  const atLevel = all.filter(item => item.level === input.level);
  const matching = sortAdObjects(atLevel.filter(item => (!input.parentId || (item.parentConsistent && item.parentId === input.parentId)) && (!input.objectId || item.objectId === input.objectId)), input.sort, input.direction);
  const size = Math.min(pageSize, actor.maxResultItems ?? pageSize);
  const page = Math.min(input.page, Math.max(1, Math.ceil(matching.length / size)));
  const items = input.format === 'csv' ? matching : matching.slice((page - 1) * size, page * size);
  const options = accounts.map(account => ({ id: account.id, name: account.name, currency: account.currency }));
  const coverage = { selectedAccounts: selected.length, coveredAccounts: new Set(matching.map(item => item.accountId)).size, requestedDays,
    unknownParentObjects: input.level === 'campaign' ? 0 : atLevel.filter(item => !item.parentId || !item.parentConsistent).length };
  const itemCount = items.reduce((total, item) => total + 1 + item.daily.length, 0) + options.length;
  if ((input.format === 'csv' && itemCount > maxRows) || (actor.maxResultItems !== undefined && itemCount > actor.maxResultItems)) throw bad();
  const csv = input.format === 'csv' ? adObjectsCsv(items, period.start, period.end, input.locale) : null;
  const result = { input, period, options, items, coverage, total: matching.length, page, pageSize: size, nextPage: input.format === 'json' && page * size < matching.length ? page + 1 : null, csv };
  if (Buffer.byteLength(JSON.stringify(result), 'utf8') > maxBytes) throw bad();
  return result;
}
