import { prisma } from '@/server/data';
import type { AutopilotSettings } from '../wordpress/autopilot';
import type { FeedActor } from './access';

/**
 * AI reply drafts for comments on recipe posts (2026-11-16, docs/autopilot-plan.md). Each new comment waiting for an
 * answer gets one draft, stored with the comment and shown ready in the Inbox reply box. Nothing is sent here.
 */
export type DraftCandidate = { id: string; message: string; fromName: string | null; channel: string; title: string; permalink: string | null; recipe: string };
export type ReplyPorts = {
  waiting(sourceId: string, since: Date, limit: number): Promise<DraftCandidate[]>;
  write(actor: FeedActor, system: string, prompt: string): Promise<string>;
  save(commentId: string, draft: string): Promise<void>;
  /** Drafts written lately for this source, newest first, so new ones do not repeat them. */
  recent?(sourceId: string, limit: number): Promise<string[]>;
};
export const DRAFTS_PER_RUN = 8;

const TONES: Record<AutopilotSettings['replies']['tone'], string> = {
  friendly: 'warm and friendly, like the person who runs the page',
  short: 'short and kind, one sentence',
  expert: 'helpful and precise, like a cook giving a tip',
};

export function replyPrompt(c: DraftCandidate, tone: AutopilotSettings['replies']['tone'], avoid: readonly string[] = []): { system: string; prompt: string } {
  const system = [
    `You reply as the French Facebook page « ${c.channel} » to a comment under its recipe post.`,
    `Tone: ${TONES[tone]}. Write in French, one or two short sentences. At most one emoji.`,
    'Answer the actual comment. Use only the recipe below for facts; if the answer is not in it, say so kindly and suggest something simple and safe.',
    c.permalink ? `If they ask for the recipe or the link, give this link: ${c.permalink}` : 'Do not include any link.',
    'Use the person’s first name only if it reads naturally. Never invent a promise, a price or a medical claim. Answer with the reply only.',
    // Replies on a public Page must not read as copies of each other (2026-11-16).
    ...(avoid.length ? ['Vary your wording: do not reuse the opening or the sentence of these recent replies:', ...avoid.slice(0, 8).map(text => `- ${text.slice(0, 160)}`)] : []),
  ].join('\n');
  const prompt = [`Comment from ${c.fromName || 'a visitor'}: ${c.message.slice(0, 800)}`, `Recipe: ${c.title}`, c.recipe ? c.recipe.slice(0, 1500) : ''].filter(Boolean).join('\n');
  return { system, prompt };
}

/** The draft, cleaned; null when unusable. A link is kept only when it is the recipe's own. */
export function cleanReply(raw: string, permalink: string | null, max = 1000): string | null {
  let text = raw.trim().replace(/^```[a-z]*\s*|```$/g, '').trim().replace(/^[«"]\s?|\s?[»"]$/g, '').trim();
  text = text.replace(/^(réponse|reply)\s*:\s*/i, '').trim();
  if (!text || text.length > max) return null;
  const links = text.match(/https?:\/\/\S+/g) ?? [];
  if (links.some(link => !permalink || link.replace(/[).,!?]+$/, '') !== permalink)) return null;
  return text;
}

export async function draftRecipeReplies(input: { sourceId: string; actor: FeedActor; pilot: AutopilotSettings; now: Date }, ports: ReplyPorts = prismaReplyPorts): Promise<number> {
  if (!input.pilot.replies.enabled) return 0;
  const waiting = await ports.waiting(input.sourceId, new Date(input.now.getTime() - 3 * 86_400_000), DRAFTS_PER_RUN);
  if (!waiting.length) return 0;
  const avoid = await ports.recent?.(input.sourceId, 8).catch(() => []) ?? [];
  let drafted = 0;
  for (const c of waiting) {
    try {
      const { system, prompt } = replyPrompt(c, input.pilot.replies.tone, avoid);
      const draft = cleanReply(await ports.write(input.actor, system, prompt), c.permalink);
      if (draft) { await ports.save(c.id, draft); avoid.unshift(draft); drafted++; }
    } catch { break; /* over the AI limit or unavailable: the next run continues */ }
  }
  return drafted;
}

export const prismaReplyPorts: ReplyPorts = {
  async waiting(sourceId, since, limit) {
    return prisma.$queryRaw<DraftCandidate[]>`SELECT pc.id, pc.message, pc."fromName", t.name AS channel, l.title, l.permalink, COALESCE(p."firstComment", '') AS recipe
      FROM post_comments pc
      JOIN post_targets pt ON pt.id = pc."postTargetId"
      JOIN posts p ON p.id = pt."postId"
      JOIN targets t ON t.id = pt."targetId"
      JOIN wordpress_recipe_plans l ON l."postId" = p.id AND l."targetId" = pt."targetId" AND l."sourceId" = ${sourceId}
      WHERE pc."parentRemoteId" IS NULL AND pc."isHidden" = false AND pc."resolvedAt" IS NULL AND pc."aiDraft" IS NULL AND pc."createdTime" >= ${since}
        AND pc."sentById" IS NULL AND (pc."fromId" IS NULL OR pc."fromId" <> t."providerId") AND length(trim(pc.message)) > 0
        AND NOT EXISTS (SELECT 1 FROM post_comments r WHERE r."postTargetId" = pc."postTargetId" AND r."parentRemoteId" = pc."remoteId" AND (r."sentById" IS NOT NULL OR r."fromId" = t."providerId"))
      ORDER BY pc."createdTime" DESC LIMIT ${limit}`;
  },
  async write(actor, system, prompt) {
    const { autopilotComplete } = await import('@/modules/studio/server/ai');
    return autopilotComplete({ userId: actor.userId, workspaceId: actor.workspaceId }, 'autopilot.reply', system, prompt, { maxTokens: 300 });
  },
  async recent(sourceId, limit) {
    const rows = await prisma.$queryRaw<Array<{ aiDraft: string }>>`SELECT pc."aiDraft" FROM post_comments pc JOIN post_targets pt ON pt.id = pc."postTargetId"
      JOIN wordpress_recipe_plans l ON l."postId" = pt."postId" AND l."targetId" = pt."targetId" AND l."sourceId" = ${sourceId}
      WHERE pc."aiDraft" IS NOT NULL ORDER BY pc."aiDraftAt" DESC NULLS LAST LIMIT ${limit}`;
    return rows.map(row => row.aiDraft);
  },
  async save(commentId, draft) {
    await prisma.$executeRaw`UPDATE post_comments SET "aiDraft" = ${draft}, "aiDraftAt" = NOW() WHERE id = ${commentId} AND "aiDraft" IS NULL`;
  },
};
