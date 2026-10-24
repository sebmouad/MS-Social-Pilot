import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { prisma } from '@/server/data';
import { runtimeConfig } from '@/server/config/store';
import { OperationError } from '@/lib/operation-error';
import { authorizeAi } from '@/modules/studio/server/access';
import { catalogFor, guarded, toolFailure, type Locale, type ToolViewerActor } from '@/modules/studio/server/tool-kit';
import { toolErrorCopy } from '@/modules/studio/server/tool-config';
import { guardedFetch, defaultFetchDeps, type FetchDeps, type FetchPolicy } from '@/modules/publishing/server/media/network/net-guard';
import { linkToolsCopySchema, linkToolsPolicySchema, type LinkToolsPolicy } from './config';
import { buildCaption, parseStructuredData, templatesFor, type CaptionFormat, type CaptionTemplate, type FactKey, type Money, type StructuredItem } from './structured-data';

export const LINK_FEATURE = 'publishing/posts';
/** Link cards and picture import already ship with the AI content tools (link preview) and the media library; this reads page details only. */
export const linkToolsRequest = z.object({ url: z.string() }).strict();
export type LinkToolsDeps = { locale?: Locale; now?: () => Date; net?: FetchDeps };

export const linkToolsPolicy = async (): Promise<LinkToolsPolicy> => linkToolsPolicySchema.parse(await runtimeConfig('publishing.linkTools.policy'));
export const linkToolsCopy = (locale: Locale) => catalogFor('publishing.linkTools.copy', linkToolsCopySchema, locale);
const fetchPolicy = (policy: LinkToolsPolicy, maxBytes: number): FetchPolicy => ({ timeoutMs: policy.timeoutMs, maxBytes, maxRedirects: policy.maxRedirects, allowHttp: policy.allowHttp, hostAllowlist: policy.hostAllowlist });

/** Fetch an address through the shared address-pinned guard; null for anything that is not an HTML page. */
async function fetchHtml(url: string, policy: LinkToolsPolicy, maxBytes: number, userAgent: string, net: FetchDeps): Promise<{ html: string; finalUrl: string } | null> {
  try {
    const result = await guardedFetch(url, fetchPolicy(policy, maxBytes), net, { headers: { 'user-agent': userAgent, accept: 'text/html,application/xhtml+xml' } });
    if (result.notModified || !result.contentType.includes('html')) return null;
    return { html: new TextDecoder('utf-8').decode(result.bytes), finalUrl: result.finalUrl };
  } catch { return null; }
}

/** Hourly request budget per workspace, claimed from the audit trail; only the host is recorded, never the full address. */
async function claim(actor: ToolViewerActor, policy: LinkToolsPolicy, kind: string, host: string, now: Date, copy: Record<string, string>) {
  await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`link-tools:${actor.workspaceId}`}))::text`;
    const used = await tx.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*)::bigint AS count FROM activity_logs WHERE "workspaceId" = ${actor.workspaceId} AND action = 'publishing.link_tool_requested' AND "createdAt" > ${new Date(now.getTime() - 3_600_000)}`;
    if (Number(used[0]?.count ?? 0) >= policy.hourlyRequests) throw new OperationError('conflict', copy.rateLimited!);
    await tx.$executeRaw`INSERT INTO activity_logs (id, "workspaceId", "actorId", action, detail, "createdAt") VALUES (${randomUUID()}, ${actor.workspaceId}, ${actor.userId}, 'publishing.link_tool_requested', ${JSON.stringify({ kind, host })}::jsonb, ${now})`;
  });
}

const fill = (template: string, values: Record<string, string | number>) => Object.entries(values).reduce((text, [key, value]) => text.replaceAll(`{${key}}`, String(value)), template);
const availabilityCode = (code: string) => code.replace(/^https?:\/\/schema\.org\//, '');

/** Words, dates and money for captions come from the Root copy catalog and Intl, so no wording lives in the parser. */
export function captionFormat(copy: Record<string, string>, locale: Locale, timeZone: string): CaptionFormat {
  const safeZone = (() => { try { new Intl.DateTimeFormat(locale, { timeZone }); return timeZone; } catch { return 'UTC'; } })();
  const money = (m: Money) => {
    const one = (value: number) => { try { return m.currency ? new Intl.NumberFormat(locale, { style: 'currency', currency: m.currency }).format(value) : new Intl.NumberFormat(locale).format(value); } catch { return `${value} ${m.currency ?? ''}`.trim(); } };
    const range = m.max !== null && m.max !== m.min ? `${one(m.min)} – ${one(m.max)}` : one(m.min);
    return m.unit && copy[`unit_${m.unit}`] ? `${range} ${copy[`unit_${m.unit}`]}` : range;
  };
  return {
    label: key => copy[`fact_${key as FactKey}`] ?? key,
    date: iso => { const hasTime = /T\d/.test(iso); return new Intl.DateTimeFormat(locale, { dateStyle: 'long', ...(hasTime ? { timeStyle: 'short' } : {}), timeZone: safeZone }).format(new Date(iso)); },
    money,
    availability: code => copy[`availability_${availabilityCode(code)}`] ?? availabilityCode(code),
    minutes: total => total >= 60 ? (total % 60 ? fill(copy.hoursMinutes!, { hours: Math.floor(total / 60), minutes: total % 60 }) : fill(copy.hoursOnly!, { hours: total / 60 })) : fill(copy.minutesOnly!, { minutes: total }),
    rating: (rating, count) => count ? fill(copy.rating!, { rating, count }) : fill(copy.ratingNoCount!, { rating }),
    countdown: days => days === 0 ? copy.countdownToday! : days === 1 ? copy.countdownTomorrow! : fill(copy.countdownDays!, { days }),
    ingredients: copy.ingredients!, steps: copy.steps!,
  };
}

/** The customer-facing view of one structured item: fact labels and ready captions per template, no raw schema. */
export function describeItem(item: StructuredItem, format: CaptionFormat, copy: Record<string, string>, now: Date) {
  const templates = templatesFor(item, now).map((id: CaptionTemplate) => ({ id, label: copy[`template_${id}`] ?? id, caption: buildCaption(item, id, format, now, null) }));
  return { kind: item.kind, name: item.name, description: item.description, url: item.url, images: item.images, templates };
}

/**
 * Read the details a public web page describes for search engines and offer captions built from them.
 * The address goes through the shared guard (HTTPS pinning, private networks refused, redirects
 * re-checked, bytes capped); each request counts against the workspace hourly budget. Nothing is saved.
 */
export async function linkTools(actor: ToolViewerActor, raw: unknown, deps: LinkToolsDeps = {}) {
  const locale = deps.locale ?? 'en';
  const errors = await toolErrorCopy(locale);
  return guarded(errors, async () => {
    const parsed = linkToolsRequest.safeParse(raw);
    if (!parsed.success) throw toolFailure(errors, 'invalid_request');
    const input = parsed.data; const policy = await linkToolsPolicy(); const copy = await linkToolsCopy(locale);
    await authorizeAi(actor, LINK_FEATURE, 'write');
    const now = (deps.now ?? (() => new Date()))(); const net = deps.net ?? defaultFetchDeps();
    const checkUrl = (value: string) => {
      const trimmed = value.trim();
      if (!trimmed || trimmed.length > policy.maxUrlCharacters) throw new OperationError('invalid_request', copy.invalidUrl!);
      try { const u = new URL(trimmed); if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error(); return trimmed; } catch { throw new OperationError('invalid_request', copy.invalidUrl!); }
    };
    const url = checkUrl(input.url);
    await claim(actor, policy, 'structured', new URL(url).hostname, now, copy);
    const page = await fetchHtml(url, policy, policy.structuredMaxBytes, policy.structuredUserAgent, net);
    const items = page ? parseStructuredData(page.html, page.finalUrl, policy.limits) : [];
    const format = captionFormat(copy, locale, policy.captionTimeZone);
    return { url, items: items.map(item => describeItem(item, format, copy, now)) };
  });
}
