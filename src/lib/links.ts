import { createHash } from 'node:crypto';

import { prisma } from './prisma';
import { env } from './env';
import { shortSlug } from './slug';

/**
 * Link tagging and shortening.
 *
 * Applied at publish time, not compose time, so the composer keeps showing the
 * real destination and a post edited before publishing does not accumulate
 * layers of redirects.
 *
 * **The sharp edge:** Facebook scrapes whatever URL appears in the post to
 * build its preview card. If that is a shortened link, the redirect must be a
 * clean 302 to a page whose Open Graph tags Facebook can read — otherwise the
 * post publishes with a blank card. `/l/[slug]` therefore does a plain 302 to
 * the tagged destination and never interposes an HTML interstitial.
 */

export interface UtmSettings {
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaignTemplate: string | null;
}

/**
 * Append UTM parameters, leaving any the URL already carries untouched — an
 * explicitly tagged link in the post text was a deliberate choice.
 */
export function applyUtm(
  rawUrl: string,
  settings: UtmSettings,
  context: { targetName?: string; date?: Date } = {},
): string {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return rawUrl;
  }

  const campaign = settings.utmCampaignTemplate
    ? renderCampaign(settings.utmCampaignTemplate, context)
    : null;

  const params: Array<[string, string | null]> = [
    ['utm_source', settings.utmSource],
    ['utm_medium', settings.utmMedium],
    ['utm_campaign', campaign],
  ];

  for (const [key, value] of params) {
    if (value && !url.searchParams.has(key)) {
      url.searchParams.set(key, value);
    }
  }
  return url.toString();
}

/** Supports {date}, {month}, {year} and {target} in the campaign template. */
function renderCampaign(template: string, context: { targetName?: string; date?: Date }): string {
  const date = context.date ?? new Date();
  const pad = (value: number) => String(value).padStart(2, '0');

  return template
    .replace(/\{date\}/g, `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`)
    .replace(/\{month\}/g, `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}`)
    .replace(/\{year\}/g, String(date.getUTCFullYear()))
    .replace(/\{target\}/g, slugPart(context.targetName ?? ''))
    .trim();
}

function slugPart(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Find every http(s) URL in a block of post text. */
export function extractUrls(text: string): string[] {
  const matches = text.match(/https?:\/\/[^\s<>"')]+/g) ?? [];
  // Trailing punctuation is almost always sentence punctuation, not the URL.
  return matches.map((url) => url.replace(/[.,;:!?]+$/, ''));
}

export function shortLinkUrl(slug: string): string {
  return `${env.shortLinkBase}/l/${slug}`;
}

/** Create (or reuse) a short link for a destination URL. */
export async function createShortLink(options: {
  workspaceId: string;
  targetUrl: string;
  postId?: string | null;
}): Promise<string> {
  // Reuse an existing link for the same post and destination so republishing
  // does not fragment the click count across several slugs.
  if (options.postId) {
    const existing = await prisma.shortLink.findFirst({
      where: { workspaceId: options.workspaceId, postId: options.postId, targetUrl: options.targetUrl },
    });
    if (existing) return shortLinkUrl(existing.slug);
  }

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const slug = shortSlug();
    try {
      await prisma.shortLink.create({
        data: {
          workspaceId: options.workspaceId,
          slug,
          targetUrl: options.targetUrl,
          postId: options.postId ?? null,
        },
      });
      return shortLinkUrl(slug);
    } catch {
      // Slug collision (unique constraint): try another.
    }
  }

  // Five collisions in a row means something is wrong; publish the real URL
  // rather than failing the post over a nicety.
  return options.targetUrl;
}

export interface PreparedLinks {
  message: string;
  link: string | null;
}

/**
 * Rewrite a post's links immediately before publishing: UTM tags first, then
 * shortening if the workspace has it on.
 */
export async function prepareLinks(options: {
  workspaceId: string;
  postId: string;
  message: string;
  link: string | null;
  settings: UtmSettings & { shortenerEnabled: boolean };
  targetName?: string;
}): Promise<PreparedLinks> {
  const { settings } = options;
  const hasUtm = Boolean(settings.utmSource || settings.utmMedium || settings.utmCampaignTemplate);

  if (!hasUtm && !settings.shortenerEnabled) {
    return { message: options.message, link: options.link };
  }

  const transform = async (url: string): Promise<string> => {
    const tagged = hasUtm ? applyUtm(url, settings, { targetName: options.targetName }) : url;
    if (!settings.shortenerEnabled) return tagged;
    return createShortLink({
      workspaceId: options.workspaceId,
      targetUrl: tagged,
      postId: options.postId,
    });
  };

  const link = options.link ? await transform(options.link) : null;

  let message = options.message;
  for (const url of extractUrls(options.message)) {
    const replacement = await transform(url);
    if (replacement !== url) message = message.split(url).join(replacement);
  }

  return { message, link };
}

/**
 * Record a click. IPs are hashed with the app secret so a repeat visitor can
 * be recognised without the raw address ever being stored.
 */
export async function recordClick(options: {
  shortLinkId: string;
  ip: string | null;
  userAgent: string | null;
  referer: string | null;
}): Promise<void> {
  await prisma.$transaction([
    prisma.linkClick.create({
      data: {
        shortLinkId: options.shortLinkId,
        ipHash: options.ip ? createHash('sha256').update(options.ip).digest('hex').slice(0, 32) : null,
        userAgent: options.userAgent?.slice(0, 500) ?? null,
        referer: options.referer?.slice(0, 500) ?? null,
      },
    }),
    prisma.shortLink.update({
      where: { id: options.shortLinkId },
      data: { clickCount: { increment: 1 } },
    }),
  ]);
}

/**
 * Crawlers and preview fetchers, which must not be counted as clicks.
 *
 * Note that Facebook's own scraper is in this list: it fetches every shortened
 * link at publish time, and counting that would give every post a click it did
 * not earn.
 */
const BOT_PATTERN =
  /bot|crawler|spider|facebookexternalhit|slackbot|twitterbot|linkedinbot|whatsapp|telegram|preview|curl|wget|headless|monitor/i;

export function isProbablyBot(userAgent: string | null): boolean {
  if (!userAgent) return true;
  return BOT_PATTERN.test(userAgent);
}
