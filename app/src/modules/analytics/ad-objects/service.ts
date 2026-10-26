import { configValueOrDefault } from '@/server/config/config-or-default';
import { cache } from 'react';
const recordsCopy = cache(() => configValueOrDefault('analytics.recordsCopy'));
import { localizeAnalyticsError } from '@/modules/analytics/server/error-copy';
import { errorCopyDefaults } from '@/modules/analytics/error-copy';
import { analyticsError } from '@/modules/analytics/server/error-copy';
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
const bad = () => new OperationError('invalid_request', errorCopyDefaults["Choose valid ad-object filters or a shorter period. / Choisissez des filtres valides ou une période plus courte."].en);
const forbidden = () => new OperationError('forbidden', errorCopyDefaults["Ad-object analytics access is unavailable. / L’analyse des objets publicitaires est indisponible."].en);

/** All entry points recheck current membership, entitlement and selected resource visibility here. No provider I/O. */
export async function readAdObjects(actor: Actor, raw: unknown = {}) {
  try {
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
  if ([defaultDays, maxDays, pageSize, maxRows, maxBytes, ...(actor.maxResultItems === undefined ? [] : [actor.maxResultItems])].some(value => !Number.isSafeInteger(value) || value < 1)) throw await analyticsError('unavailable', "Analytics settings are unavailable. / Les paramètres sont indisponibles.");
  let period;
  try { period = analyticsDateRange(input, { defaultDays: Math.min(defaultDays, maxDays), maxDays }); } catch { throw bad(); }
  const providers = entitledPlatformIds(entitlements);
  const accounts = await getAdsAccounts(actor.workspaceId, targetIds, providers, actor.allowedAdAccountIds);
  if (input.accountId && !accounts.some(account => account.id === input.accountId)) throw forbidden();
  const selected = accounts.filter(account => !input.accountId || account.id === input.accountId);
  const dataset = await getAdsDataset(actor.workspaceId, { period: 'custom', since: period.range.from, until: new Date(period.range.to.getTime() + 1), accountId: input.accountId ?? null }, targetIds, providers, { levels: ['campaign', 'adset', 'ad'], allowedAdAccountIds: actor.allowedAdAccountIds });
  if (dataset.insights.length > maxRows) throw new OperationError('invalid_request', `This period holds ${dataset.insights.length} stored rows, above the ${maxRows}-row limit. Choose an ad account (accountId) or a shorter period.`);
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
  if (input.parentId && !all.some(item => item.accountId === input.accountId && item.level === (input.level === 'adset' ? 'campaign' : 'adset') && item.objectId === input.parentId)) throw await analyticsError('not_found', "The parent has no stored data in this period. / Le parent ne contient aucune donnée pour cette période.");
  const atLevel = all.filter(item => item.level === input.level);
  const matching = sortAdObjects(atLevel.filter(item => (!input.parentId || (item.parentConsistent && item.parentId === input.parentId)) && (!input.objectId || item.objectId === input.objectId)), input.sort, input.direction);
  const size = Math.min(pageSize, actor.maxResultItems ?? pageSize);
  const page = Math.min(input.page, Math.max(1, Math.ceil(matching.length / size)));
  const items = input.format === 'csv' ? matching : matching.slice((page - 1) * size, page * size);
  const options = accounts.map(account => ({ id: account.id, name: account.name, currency: account.currency }));
  // Selection-wide daily totals per account for the trend hero: computed pre-paging over the same
  // filtered objects as the table, so the chart never disagrees with the selection. Sibling objects
  // are disjoint delivery, so within one account/currency the days add up; a day is unknown only when
  // none of its objects reported.
  const accountDaily = [...matching.reduce((byAccount, item) => {
    const days = byAccount.get(item.accountId) ?? { accountId: item.accountId, accountName: item.accountName, currency: item.currency, days: new Map<string, { spend: number | null; impressions: number | null }>() };
    for (const row of item.daily) {
      const dayKey = row.date.slice(0, 10);
      const day = days.days.get(dayKey) ?? { spend: null, impressions: null };
      if (row.spend !== null) day.spend = (day.spend ?? 0) + row.spend;
      if (row.impressions !== null) day.impressions = (day.impressions ?? 0) + row.impressions;
      days.days.set(dayKey, day);
    }
    byAccount.set(item.accountId, days);
    return byAccount;
  }, new Map<string, { accountId: string; accountName: string; currency: string | null; days: Map<string, { spend: number | null; impressions: number | null }> }>()).values()]
    .map(account => {
      // Meta stores no row for a day without delivery; up to the account's last sync that day is a real zero, so the
      // trend spans the chosen period instead of ending where delivery stopped. Later days stay unknown and are not drawn.
      const synced = dataset.accounts.find(item => item.id === account.accountId)?.lastSyncedAt ?? null;
      const end = synced && synced < period.range.to ? synced : period.range.to;
      for (let day = new Date(Date.UTC(period.range.from.getUTCFullYear(), period.range.from.getUTCMonth(), period.range.from.getUTCDate())); day <= end; day = new Date(day.getTime() + 86_400_000)) {
        const key = day.toISOString().slice(0, 10);
        if (!account.days.has(key)) account.days.set(key, { spend: 0, impressions: 0 });
      }
      return { accountId: account.accountId, accountName: account.accountName, currency: account.currency,
        daily: [...account.days].sort(([a], [b]) => a.localeCompare(b)).map(([date, day]) => ({ date, spend: day.spend, impressions: day.impressions })) };
    })
    .sort((a, b) => a.accountName.localeCompare(b.accountName));
  const coverage = { selectedAccounts: selected.length, coveredAccounts: new Set(matching.map(item => item.accountId)).size, requestedDays,
    unknownParentObjects: input.level === 'campaign' ? 0 : atLevel.filter(item => !item.parentId || !item.parentConsistent).length };
  const itemCount = items.reduce((total, item) => total + 1 + item.daily.length, 0) + options.length;
  // Each object counts once plus one per stored day, so a long period multiplies quickly: say so instead of a generic refusal.
  const tooLarge = (limit: number) => new OperationError('invalid_request', `This selection holds ${itemCount} items (objects and their daily rows), above the ${limit}-item limit. Choose an ad account (accountId), a level, a later page or a shorter period.`);
  if (input.format === 'csv' && itemCount > maxRows) throw tooLarge(maxRows);
  if (actor.maxResultItems !== undefined && itemCount > actor.maxResultItems) throw tooLarge(actor.maxResultItems);
  const csv = input.format === 'csv' ? adObjectsCsv(items, period.start, period.end, input.locale, await recordsCopy()) : null;
  const result = { input, period, options, items, accountDaily, coverage, total: matching.length, page, pageSize: size, nextPage: input.format === 'json' && page * size < matching.length ? page + 1 : null, csv };
  if (Buffer.byteLength(JSON.stringify(result), 'utf8') > maxBytes) throw new OperationError('invalid_request', `This result is above the ${Math.round(maxBytes / 1000)} KB limit. Choose an ad account (accountId), a level or a shorter period.`);
  return result;

  } catch (error) { throw await localizeAnalyticsError(error); }
}
