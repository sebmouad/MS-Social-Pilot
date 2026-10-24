import { z } from 'zod';
import { prisma } from '@/server/data';
import { configOrDefault } from '@/server/config/config-or-default';
import { runtimeConfig } from '@/server/config/store';
import { OPERATOR_DEFAULTS, SITE_CONTENT_DEFAULTS, frenchTypography, operatorSchema, siteContentSchema, type SiteLocale, type SitePageContent } from '../public/content';
import { listPublicChangelog, type ChangelogEntry } from './changelog';
import { readSystemHealth, type SystemHealth } from './health';

/**
 * Read model of the public site. Pages are anonymous, so everything here is public by design: Root-written text, the
 * operator details Root chose to publish, the plan catalog, changelog entries and a two-line health summary. A setting
 * that cannot be read falls back to the registry default so the legal pages never go dark.
 */
export async function siteIsPublic(): Promise<boolean> {
  return configOrDefault('public.siteEnabled', z.boolean()).catch(() => false);
}

export async function loadSiteContent(locale: SiteLocale): Promise<SitePageContent> {
  const content = await configOrDefault('public.content', siteContentSchema).catch(() => SITE_CONTENT_DEFAULTS);
  return locale === 'fr' ? frenchTypography(content.fr) : content.en;
}

export async function loadOperator() {
  const [operator, origin] = await Promise.all([
    configOrDefault('public.operator', operatorSchema).catch(() => OPERATOR_DEFAULTS),
    runtimeConfig('app.publicOrigin').catch(() => ''),
  ]);
  return { operator, appUrl: typeof origin === 'string' ? origin : '' };
}

export type PublicPlan = { key: string; name: string; currency: string; priceMonthly: number; priceYearly: number; extraChannelPrice: number; channels: number | null; members: number | null; postsPerMonth: number | null; features: string[] };

/** The plans Root defined in Root › Plans, in Root's order. Prices are stored in cents. */
export async function listPublicPlans(): Promise<PublicPlan[]> {
  return prisma.$queryRaw<PublicPlan[]>`SELECT key, name, currency, "priceMonthly", "priceYearly", "extraChannelPrice", channels, members, "postsPerMonth", features FROM plans ORDER BY position ASC, key ASC`;
}

export const loadPublicChangelog = (): Promise<ChangelogEntry[]> => listPublicChangelog().catch(() => []);
export const loadPublicHealth = (): Promise<SystemHealth> => readSystemHealth();
