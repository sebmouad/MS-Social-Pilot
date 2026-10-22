import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { prisma } from '@/server/data';
import { runtimeConfig } from '@/server/config/store';
import { OperationError } from '@/lib/operation-error';
import { createPublishingPost } from '@/modules/publishing/server/api-writes';
import { authorizeAi } from '../access';
import { COMPOSER_FEATURE, runAssist, type AiDeps } from '../ai';
import { catalogFor, guarded, toolFailure, type Locale, type ToolViewerActor } from '../tool-kit';
import { toolErrorCopy } from '../tool-config';
import { translatedPostsCopySchema, translatedPostsPolicySchema } from '../../config';

export const TRANSLATED_CONFIRMATION = 'CREATE TRANSLATED POSTS';
const ids = z.array(z.string().min(1)).min(1).max(500);
/** Post options that apply identically to every language; the lifecycle service validates each. */
const SHARED_OPTIONS = ['firstComment', 'firstCommentDelayMinutes', 'link', 'media', 'imageUrl', 'videoUrl', 'destinationFormats', 'scheduledAt', 'scheduleMode', 'destinationScheduleModes', 'labelId'] as const;
export const translatedRequest = z.discriminatedUnion('action', [
  z.object({ action: z.literal('suggest'), message: z.string().trim().min(1), translations: z.array(z.object({ language: z.string().trim().min(2), targetIds: ids }).strict()).min(1) }).strict(),
  z.object({ action: z.literal('create'), message: z.string(), targetIds: ids, translations: z.array(z.object({ targetIds: ids, message: z.string() }).strict()).min(1), options: z.record(z.string(), z.unknown()).optional(), confirmation: z.string() }).strict(),
]);
export type TranslatedResult = { postId: string; targetIds: string[]; kind: 'original' | 'translation' };
export const translatedCopy = (locale: Locale) => catalogFor('ai.translatedPosts.copy', translatedPostsCopySchema, locale);

/** The channels no translation claims keep the original text; each translation goes to its own channels. */
export function planTranslatedParts(message: string, targetIds: string[], translations: Array<{ targetIds: string[]; message: string }>) {
  const claimed = new Set(translations.flatMap(t => t.targetIds));
  const rest = targetIds.filter(id => !claimed.has(id));
  return [...(rest.length ? [{ kind: 'original' as const, targetIds: rest, message }] : []), ...translations.map(t => ({ kind: 'translation' as const, targetIds: t.targetIds, message: t.message }))];
}

/**
 * Suggest translations (metered AI, review only) or create one post per language. Creating needs the
 * exact confirmation, current Posts write access and channel scope; every post goes through the
 * Publishing lifecycle service, so approvals, limits, versions and audit apply to each.
 */
export async function translatedPosts(actor: ToolViewerActor, raw: unknown, deps: AiDeps & { locale?: Locale } = {}) {
  const locale = deps.locale ?? 'en';
  const errors = await toolErrorCopy(locale);
  return guarded(errors, async () => {
    const parsed = translatedRequest.safeParse(raw);
    if (!parsed.success) throw toolFailure(errors, 'invalid_request');
    const input = parsed.data; const copy = await translatedCopy(locale);
    const policy = translatedPostsPolicySchema.parse(await runtimeConfig('ai.translatedPosts.policy'));
    await authorizeAi(actor, COMPOSER_FEATURE, 'write');
    if (input.translations.length > policy.maxTranslations) throw new OperationError('invalid_request', copy.tooMany!);
    const all = input.translations.flatMap(t => t.targetIds);
    if (new Set(all).size !== all.length) throw new OperationError('invalid_request', copy.overlap!);
    if (input.action === 'suggest') {
      if (input.message.length > policy.suggestMaxCharacters) throw toolFailure(errors, 'invalid_request');
      const suggestions: Array<{ language: string; targetIds: string[]; message: string }> = [];
      for (const t of input.translations) {
        const result = await runAssist(actor, { kind: 'translate', text: input.message, language: t.language }, deps);
        suggestions.push({ language: t.language, targetIds: t.targetIds, message: result.text });
      }
      return { suggestions, reviewRequired: true as const };
    }
    if (input.confirmation !== TRANSLATED_CONFIRMATION) throw new OperationError('invalid_request', copy.confirmation!);
    if (!input.message.trim() || input.translations.some(t => !t.message.trim())) throw new OperationError('invalid_request', copy.needText!);
    if (new Set(input.targetIds).size !== input.targetIds.length || all.some(id => !input.targetIds.includes(id))) throw new OperationError('invalid_request', copy.overlap!);
    const options: Record<string, unknown> = {};
    for (const key of SHARED_OPTIONS) if (input.options && input.options[key] !== undefined) options[key] = input.options[key];
    if (input.options && Object.keys(input.options).some(key => !(SHARED_OPTIONS as readonly string[]).includes(key))) throw toolFailure(errors, 'invalid_request');
    let firstError: unknown;
    const created: TranslatedResult[] = []; const failed: Array<{ targetIds: string[]; kind: 'original' | 'translation' }> = [];
    for (const part of planTranslatedParts(input.message, input.targetIds, input.translations)) {
      try {
        const result = await createPublishingPost(actor, { ...options, message: part.message, targetIds: part.targetIds, confirmation: 'CREATE POST' }) as { id?: string; postId?: string };
        const postId = result.id ?? result.postId;
        if (!postId) throw new Error('no post id');
        created.push({ postId, targetIds: part.targetIds, kind: part.kind });
      } catch (error) { firstError ??= error; failed.push({ targetIds: part.targetIds, kind: part.kind }); }
    }
    await prisma.$executeRaw`INSERT INTO activity_logs (id, "workspaceId", "actorId", action, detail, "createdAt") VALUES (${randomUUID()}, ${actor.workspaceId}, ${actor.userId}, 'publishing.translated_posts_created', ${JSON.stringify({ postIds: created.map(c => c.postId), failedGroups: failed.length })}::jsonb, now())`;
    if (!created.length) throw firstError instanceof OperationError ? firstError : toolFailure(errors, 'upstream_failure');
    return { created, failed, complete: failed.length === 0 };
  });
}
