import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { prisma } from '@/server/data';
import { runtimeConfig } from '@/server/config/store';
import { PublishingOperationError, type PublishingErrorKey, type PublishingErrorText } from '@/modules/publishing/error-catalog';
import { loadPublishingErrorText } from './error-copy';
import { authorizePublishing } from './access';
import type { PublishingActor } from './types';

/**
 * Per-language post variants (text only). One post carries a default text plus at most one
 * variant per locale; each destination receives the variant matching its effective language.
 *
 * Variant selection rule (deterministic, documented):
 *   1. the variant whose locale exactly matches the destination's effective locale;
 *   2. otherwise the variant sharing the destination's language subtag (fr-CA falls back to fr);
 *      ties resolve to the shortest locale, then alphabetical order;
 *   3. otherwise the post's default text.
 * Effective destination locale = the destination's own locale, else the workspace default
 * locale, else none (default text). Media is not overridden per language: the publishing
 * pipeline sends one media set per post, so variants are text-only by design.
 */

const LOCALE_PATTERN = /^([a-zA-Z]{2})(?:-([a-zA-Z]{2}))?$/;

/** Normalize a BCP 47 short tag (en, fr-CA); null when it is not one. */
export function normalizeLocale(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = LOCALE_PATTERN.exec(value.trim());
  if (!match) return null;
  return `${match[1]!.toLowerCase()}${match[2] ? `-${match[2].toUpperCase()}` : ''}`;
}

export type PostVariant = { locale: string; message: string };

/** Pure selection rule shared by publishing, reads and tests. */
export function resolveVariantMessage(defaultMessage: string, variants: readonly PostVariant[], locale: string | null): { message: string; variantLocale: string | null } {
  if (!locale) return { message: defaultMessage, variantLocale: null };
  const wanted = locale.toLowerCase();
  const exact = variants.find(variant => variant.locale.toLowerCase() === wanted);
  if (exact) return { message: exact.message, variantLocale: exact.locale };
  const language = wanted.split('-')[0]!;
  const candidates = variants
    .filter(variant => variant.locale.toLowerCase().split('-')[0] === language)
    .sort((a, b) => a.locale.length - b.locale.length || (a.locale < b.locale ? -1 : a.locale > b.locale ? 1 : 0));
  if (candidates[0]) return { message: candidates[0].message, variantLocale: candidates[0].locale };
  return { message: defaultMessage, variantLocale: null };
}

export const addVariantConfirmation = (postId: string, locale: string) => `ADD VARIANT ${postId} ${locale}`;
export const removeVariantConfirmation = (postId: string, locale: string) => `REMOVE VARIANT ${postId} ${locale}`;
export const destinationLocaleConfirmation = (targetId: string) => `SET DESTINATION LOCALE ${targetId}`;

const request = z.discriminatedUnion('action', [
  z.object({ action: z.literal('list'), postId: z.string().min(1).max(200) }).strict(),
  z.object({ action: z.literal('add'), postId: z.string().min(1).max(200), locale: z.string().min(1).max(12), message: z.string().min(1), confirmation: z.string() }).strict(),
  z.object({ action: z.literal('remove'), postId: z.string().min(1).max(200), locale: z.string().min(1).max(12), confirmation: z.string() }).strict(),
  z.object({ action: z.literal('destination-locale'), targetId: z.string().min(1).max(200), locale: z.string().max(12).nullable(), confirmation: z.string() }).strict(),
]);

const MANAGERS = new Set(['owner', 'admin', 'editor']);
const bad = (text: PublishingErrorText, code: 'invalid_request' | 'forbidden' | 'not_found' | 'conflict', key: PublishingErrorKey) =>
  new PublishingOperationError(code, key, {}, text);
const invalid = (text: PublishingErrorText) => bad(text, 'invalid_request', 'chooseValidVariantDetailsAndConfirmTheExactAction');

type DestinationRow = { id: string; targetId: string; name: string; targetLocale: string | null };

async function postOrThrow(actor: PublishingActor, postId: string, text: PublishingErrorText) {
  const [post] = await prisma.$queryRaw<Array<{ id: string; authorId: string; message: string }>>`SELECT id, "authorId", message FROM posts WHERE id = ${postId} AND "workspaceId" = ${actor.workspaceId}`;
  if (!post) throw bad(text, 'not_found', 'thisPostIsUnavailableInTheCurrentWorkspace');
  if (actor.allowedTargetIds) {
    const rows = await prisma.$queryRaw<Array<{ targetId: string }>>`SELECT "targetId" FROM post_targets WHERE "postId" = ${postId}`;
    if (rows.some(row => !actor.allowedTargetIds!.includes(row.targetId))) throw bad(text, 'forbidden', 'thisPostIsUnavailableInYourChannelScope');
  }
  return post;
}

async function workspaceLocale(workspaceId: string): Promise<string | null> {
  const [row] = await prisma.$queryRaw<Array<{ defaultLocale: string }>>`SELECT "defaultLocale"::text AS "defaultLocale" FROM workspaces WHERE id = ${workspaceId}`;
  return normalizeLocale(row?.defaultLocale ?? null);
}

async function destinationsOf(actor: PublishingActor, postId: string): Promise<DestinationRow[]> {
  const rows = await prisma.$queryRaw<Array<{ id: string; targetId: string; name: string; targetLocale: string | null }>>`SELECT pt.id, pt."targetId", t.name, t.locale AS "targetLocale" FROM post_targets pt JOIN targets t ON t.id = pt."targetId" AND t."workspaceId" = ${actor.workspaceId} WHERE pt."postId" = ${postId} ORDER BY t.name, pt."targetId"`;
  return actor.allowedTargetIds ? rows.filter(row => actor.allowedTargetIds!.includes(row.targetId)) : rows;
}

async function variantsOf(workspaceId: string, postId: string): Promise<PostVariant[]> {
  return prisma.$queryRaw<PostVariant[]>`SELECT locale, message FROM post_language_variants WHERE "workspaceId" = ${workspaceId} AND "postId" = ${postId} ORDER BY locale`;
}

async function audit(actor: PublishingActor, action: string, detail: object) {
  await prisma.$executeRaw`INSERT INTO activity_logs (id, "workspaceId", "actorId", action, detail, "createdAt") VALUES (${randomUUID()}, ${actor.workspaceId}, ${actor.userId}, ${action}, ${JSON.stringify(detail)}::jsonb, NOW())`;
}

export type VariantListing = {
  postId: string; defaultMessage: string; workspaceLocale: string | null; variants: PostVariant[];
  destinations: Array<{ targetId: string; name: string; effectiveLocale: string | null; variantLocale: string | null; message: string }>;
};

/** UI, REST and MCP share validation, fresh authority, channel scope and exact confirmations. */
export async function postVariants(actor: PublishingActor, raw: unknown): Promise<VariantListing | { ok: true; postId?: string; targetId?: string; locale?: string | null }> {
  const errorText = await loadPublishingErrorText();
  const parsed = request.safeParse(raw);
  if (!parsed.success) throw invalid(errorText);
  const input = parsed.data;
  const auth = await authorizePublishing(actor, 'publishing/posts', input.action === 'list' ? 'read' : 'write');
  const scoped = auth.actor;
  if (input.action === 'destination-locale') {
    const locale = input.locale === null ? null : normalizeLocale(input.locale);
    if (input.locale !== null && !locale) throw invalid(errorText);
    if (input.confirmation !== destinationLocaleConfirmation(input.targetId)) throw invalid(errorText);
    if (scoped.allowedTargetIds && !scoped.allowedTargetIds.includes(input.targetId)) throw bad(errorText, 'forbidden', 'thisPostIsUnavailableInYourChannelScope');
    const changed = await prisma.$executeRaw`UPDATE targets SET locale = ${locale} WHERE id = ${input.targetId} AND "workspaceId" = ${scoped.workspaceId}`;
    if (changed !== 1) throw bad(errorText, 'not_found', 'thisDestinationIsUnavailableInTheCurrentWorkspace');
    await audit(scoped, 'publishing.destination_locale_changed', { targetId: input.targetId, locale });
    return { ok: true as const, targetId: input.targetId, locale };
  }
  const post = await postOrThrow(scoped, input.postId, errorText);
  if (input.action === 'list') {
    const [variants, destinations, fallback] = await Promise.all([variantsOf(scoped.workspaceId, post.id), destinationsOf(scoped, post.id), workspaceLocale(scoped.workspaceId)]);
    return {
      postId: post.id, defaultMessage: post.message, workspaceLocale: fallback, variants,
      destinations: destinations.map(row => {
        const effectiveLocale = row.targetLocale ?? fallback;
        const resolved = resolveVariantMessage(post.message, variants, effectiveLocale);
        return { targetId: row.targetId, name: row.name, effectiveLocale, variantLocale: resolved.variantLocale, message: resolved.message };
      }),
    };
  }
  if (!MANAGERS.has(auth.role) && post.authorId !== scoped.userId) throw bad(errorText, 'not_found', 'thisPostIsUnavailableInTheCurrentWorkspace');
  const locale = normalizeLocale(input.locale);
  if (!locale) throw invalid(errorText);
  if (input.action === 'add') {
    if (input.confirmation !== addVariantConfirmation(post.id, locale)) throw invalid(errorText);
    const [maxPerPost, maxChars] = await Promise.all([runtimeConfig('publishing.postVariantsMaxPerPost'), runtimeConfig('publishing.maxMessageCharacters')]);
    const message = input.message.trim();
    if (!message || message.length > Number(maxChars)) throw invalid(errorText);
    const existing = await variantsOf(scoped.workspaceId, post.id);
    if (!existing.some(variant => variant.locale === locale) && existing.length >= Number(maxPerPost)) throw bad(errorText, 'conflict', 'thisPostAlreadyHasTheMaximumLanguageVariants');
    await prisma.$executeRaw`INSERT INTO post_language_variants (id, "postId", "workspaceId", locale, message) VALUES (${randomUUID()}, ${post.id}, ${scoped.workspaceId}, ${locale}, ${message})
      ON CONFLICT ("postId", locale) DO UPDATE SET message = ${message}, "updatedAt" = NOW()`;
    await audit(scoped, 'publishing.variant_saved', { postId: post.id, locale });
    return { ok: true as const, postId: post.id, locale };
  }
  if (input.confirmation !== removeVariantConfirmation(post.id, locale)) throw invalid(errorText);
  const removed = await prisma.$executeRaw`DELETE FROM post_language_variants WHERE "postId" = ${post.id} AND "workspaceId" = ${scoped.workspaceId} AND locale = ${locale}`;
  if (removed !== 1) throw bad(errorText, 'not_found', 'thisVariantIsUnavailableInTheCurrentWorkspace');
  await audit(scoped, 'publishing.variant_removed', { postId: post.id, locale });
  return { ok: true as const, postId: post.id, locale };
}

/**
 * Variant rows plus effective locales for the publish path. A missing table (older database)
 * resolves to no variants so publishing never fails mid-deploy; only writes need the migration.
 */
export async function variantSelectionForPublish(workspaceId: string, postId: string, targetIds: readonly string[]): Promise<{ variants: PostVariant[]; locales: Map<string, string | null>; workspaceLocale: string | null }> {
  try {
    const [variants, locales, fallback] = await Promise.all([
      variantsOf(workspaceId, postId),
      targetIds.length ? prisma.$queryRaw<Array<{ id: string; locale: string | null }>>`SELECT id, locale FROM targets WHERE "workspaceId" = ${workspaceId} AND id = ANY(${[...targetIds]})` : Promise.resolve([]),
      workspaceLocale(workspaceId),
    ]);
    return { variants, locales: new Map(locales.map(row => [row.id, row.locale])), workspaceLocale: fallback };
  } catch {
    return { variants: [], locales: new Map(), workspaceLocale: null };
  }
}

