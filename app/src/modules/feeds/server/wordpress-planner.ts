import { OperationError } from '@/lib/operation-error';
import { prisma } from '@/server/data';
import { decryptSecret } from '@/server/secret-crypto';
import { defaultFetchDeps, type FetchDeps } from '@/modules/publishing/server/media/network/net-guard';
import type { ArticleInput, ArticleWriting } from '@/modules/studio/ai';
import { autopilotOf, type AutopilotSettings } from '../wordpress/autopilot';
import { prismaScoringPorts, pageLearning, PHOTO_BATCH, PHOTO_VERSION, type ScoringPorts, type Rating } from './wordpress-scoring';
import { makePicker } from './wordpress-pick';
import { guessKind, titleWords, type RecipeKind } from '../wordpress/score';
import { captionGuidance, hitBoost, hitWords, memoryModel, photoWeak } from '../wordpress/memory';
import { bestStyle, captionPrompt, cleanCaption, clicheIn, ctaFor, opensLike, postingMoment, styleFor, voiceFor, withCta, type HookStyle } from '../wordpress/caption';
import { instantToWall } from '@/lib/calendar-dates';
import { allocateRecipes, channelConfig, recipeTitleKey, buildImageUrl, buildPermalink, reportedPermalink, parseRecipe, renderComment, resolveConfig, slotInstants, type PlanConfig, type Recipe, type SlotNeed } from '../wordpress/recipe';
import { openWordpressDb, type DbSettings, type WpDb, type WpCandidateRow } from '../wordpress/db';
import { defaultImagePorts, prepareRecipeImage, RecipeImageError, type ImagePorts } from '../wordpress/image';
import { qualifyingOwner, type FeedActor, type FeedAuthorization } from './access';
import { loadWordpressSettings, patchLimits, type WordpressSettings } from './wordpress-settings';
import { prismaRecipeStore, type LedgerRow, type RecipeStore, type SourceRow } from './wordpress-store';

const MS_DAY = 86_400_000;

export type PlannerPorts = {
  openDb(settings: DbSettings): Promise<WpDb>;
  validateTarget(actor: FeedActor, targetId: string): Promise<void>;
  createPost(actor: FeedActor, input: PlannedPostInput): Promise<{ id: string }>;
  /** Publishing's own cancel of a queued post (back to draft); throws when the post can no longer be cancelled. */
  cancelPost(actor: FeedActor, postId: string): Promise<void>;
  /** Resolve durable recipe identity regardless of current post state/time; throw when identity is unknown. */
  postForSlot(workspaceId: string, targetId: string, slotAt: Date): Promise<{ id: string } | null>;
  image: ImagePorts;
  qualify(workspaceId: string): Promise<FeedAuthorization | null>;
  store: RecipeStore;
  /** AI that writes a caption and the first comment's lists from any post's own text, when the workspace has AI on. */
  writer: { available(workspaceId: string): Promise<boolean>; write(actor: FeedActor, article: ArticleInput): Promise<ArticleWriting> };
  now(): Date;
  /** Autopilot scoring (2026-11-16); without it recipes go out in the source's order. */
  scoring?: import('./wordpress-scoring').ScoringPorts;
  /** Autopilot captions (2026-11-16): one AI request for a channel's caption; without it the recipe's own caption is used. */
  captions?: { write(actor: FeedActor, system: string, prompt: string): Promise<string>; recent?(sourceId: string, limit: number): Promise<string[]> };
  /** Generated photos for weak recipe photos (2026-11-19, ./wordpress-photos.ts); off without it. */
  generatePhotos?: boolean;
};
export type PlannedPostInput = { message: string; firstComment: string; targetIds: string[]; scheduledAt: Date; media: Array<{ kind: 'image'; url: string; altText: string }>; firstCommentDelayMinutes: number };

export function defaultPlannerPorts(net: FetchDeps = defaultFetchDeps()): PlannerPorts {
  return {
    generatePhotos: true,
    openDb: settings => openWordpressDb(settings),
    async validateTarget(actor, targetId) {
      const { validateTargets } = await import('@/modules/publishing/server/lifecycle');
      await validateTargets({ userId: actor.userId, workspaceId: actor.workspaceId, ...(actor.allowedTargetIds === undefined ? {} : { allowedTargetIds: actor.allowedTargetIds }) }, [targetId], 1, [], true, null, undefined, true);
    },
    async createPost(actor, input) {
      const { createPost } = await import('@/modules/publishing/server/lifecycle');
      return createPost({ userId: actor.userId, workspaceId: actor.workspaceId, ...(actor.allowedTargetIds === undefined ? {} : { allowedTargetIds: actor.allowedTargetIds }) }, input);
    },
    async cancelPost(actor, postId) {
      const { cancelScheduledPost } = await import('@/modules/publishing/server/lifecycle');
      await cancelScheduledPost({ userId: actor.userId, workspaceId: actor.workspaceId, ...(actor.allowedTargetIds === undefined ? {} : { allowedTargetIds: actor.allowedTargetIds }) }, postId);
    },
    async postForSlot(workspaceId, targetId, slotAt) {
      const rows = await prisma.$queryRaw<Array<{ postId: string | null }>>`SELECT "postId" FROM wordpress_recipe_plans
        WHERE "workspaceId" = ${workspaceId} AND "targetId" = ${targetId} AND "slotAt" = ${slotAt}`;
      // A time/channel match is not provenance. In particular, cancellation clears scheduledAt.
      // Old interrupted creates without a saved identity require reconciliation, never a blind resend.
      if (rows.length !== 1 || !rows[0]!.postId) throw new Error('Recipe post identity is unconfirmed');
      const post = await prisma.post.findFirst({ where: { id: rows[0]!.postId, workspaceId }, select: { id: true } });
      if (!post) throw new Error('Recipe post identity is unconfirmed');
      return post;
    },
    image: defaultImagePorts(net),
    qualify: workspaceId => qualifyingOwner(workspaceId),
    store: prismaRecipeStore,
    writer: {
      async available(workspaceId) { const { articleWritingAvailable } = await import('@/modules/studio/server/ai'); return articleWritingAvailable(workspaceId); },
      async write(actor, article) { const { writeFromArticle } = await import('@/modules/studio/server/ai'); return writeFromArticle({ userId: actor.userId, workspaceId: actor.workspaceId }, article); },
    },
    now: () => new Date(),
    scoring: prismaScoringPorts,
    captions: {
      async write(actor, system, prompt) { const { autopilotComplete } = await import('@/modules/studio/server/ai'); return autopilotComplete({ userId: actor.userId, workspaceId: actor.workspaceId }, 'autopilot.caption', system, prompt, { maxTokens: 600 }); },
      async recent(sourceId, limit) {
        const rows = await prisma.$queryRaw<Array<{ message: string }>>`SELECT p.message FROM wordpress_recipe_plans l JOIN posts p ON p.id = l."postId" WHERE l."sourceId" = ${sourceId} AND l.style IS NOT NULL ORDER BY l."claimedAt" DESC LIMIT ${limit}`;
        return rows.map(row => row.message.split('\n')[0]!.slice(0, 90));
      },
    },
  };
}

/* ----- candidates ----- */

/** `write` names what AI writes from the post at planning time: the caption, the recipe, or both. */
export type Candidate = { wpPostId: string; title: string; slug: string; caption: string; imageUrl: string; permalink: string; recipe: Recipe; publishedAt: Date | null; write?: { article: ArticleInput; caption: boolean; recipe: boolean } };
/** Why scanned posts were not candidates; shown with an empty run so the cause is visible. */
export type ScanRejections = { shared: number; caption: number; image: number; link: number; recipe: number; captionFieldMissing?: number };
export type Scan = { candidates: Candidate[]; scanned: number; exhausted: boolean; rejected: ScanRejections };

/**
 * Read recipes from WordPress newest (or oldest) first until `enough` says the candidates found so far suffice
 * or the scan limit is reached. Rows without a usable caption, image file, link or recipe are not candidates; with
 * `writer`, a post whose caption or recipe field is left empty is one when it has text for AI to write them from.
 */
export async function scanCandidates(db: WpDb, settings: WordpressSettings, source: Pick<SourceRow, 'siteUrl'>, config: PlanConfig, now: Date, enough: (candidates: Candidate[]) => boolean, writer = false): Promise<Scan> {
  const candidates: Candidate[] = [];
  let scanned = 0; let exhausted = false;
  const rejected: ScanRejections = { shared: 0, caption: 0, image: 0, link: 0, recipe: 0, captionFieldMissing: 0 };
  while (scanned < settings.candidateMaxScan) {
    const limit = Math.min(settings.candidateBatchSize, settings.candidateMaxScan - scanned);
    const { rows, fetched, requested } = await db.candidates({ mapping: config.mapping, order: config.order, skipShared: config.skipShared, maxAgeDays: config.maxAgeDays, offset: scanned, limit, now });
    // Only WordPress returning a short page ends the library; posts filtered out locally (already shared) do not.
    if (!fetched) { exhausted = true; break; }
    scanned += fetched;
    rejected.shared += fetched - rows.length;
    candidates.push(...await toCandidates(db, settings, source, config, rows, writer, rejected, candidates));
    if (enough(candidates)) break;
    if (fetched < requested) { exhausted = true; break; }
    // A whole first page without the caption field means WordPress is not exposing it (credentials or REST
    // registration), not that these recipes lack captions: scanning thousands more posts would find the same.
    if (!candidates.length && rows.length > 0 && rejected.captionFieldMissing === scanned - rejected.shared) break;
    // Likewise posts without recipe data and no AI to write it: the rest of the library is the same.
    if (!candidates.length && rows.length > 0 && !writer && !config.mapping.recipeMetaKey && rejected.recipe === scanned - rejected.shared) break;
  }
  return { candidates, scanned, exhausted, rejected };
}

/** A caption people can read: at least 25 characters and 4 words (2026-11-16). */
export const usableCaption = (text: string) => { const t = text.trim(); return t.length >= 25 && t.split(/\s+/).filter(word => /\p{L}/u.test(word)).length >= 4; };

/** Turn WordPress rows into usable candidates, counting why the others are not (shared by scans and by reads of chosen posts). */
async function toCandidates(db: WpDb, settings: WordpressSettings, source: Pick<SourceRow, 'siteUrl'>, config: PlanConfig, rows: WpCandidateRow[], writer: boolean, rejected: ScanRejections, seen: readonly Candidate[] = []): Promise<Candidate[]> {
  const files = await db.attachments(rows.map(r => r.imageId), config.mapping.attachedFileMetaKey);
  const out: Candidate[] = [];
  for (const row of rows) {
    // New posts published during a scan shift offsets; never list one recipe twice.
    if (seen.some(candidate => candidate.wpPostId === row.id) || out.some(candidate => candidate.wpPostId === row.id)) continue;
    const file = files.get(row.imageId);
    const imageUrl = file ? buildImageUrl(source.siteUrl, settings.uploadsPath, file) : null;
    const permalink = reportedPermalink(source.siteUrl, row.link) ?? buildPermalink(settings.permalinkTemplate, source.siteUrl, row.slug);
    const recipe = parseRecipe(row.recipe, row.title, settings.minutesSuffix);
    const text = writer && row.article ? row.article : '';
    // A caption too short to be one (« p3 », a placeholder) counts as missing (2026-11-16): AI writes it, or the post is skipped.
    const caption = usableCaption(row.caption) ? row.caption : '';
    const write = { caption: Boolean(text) && (!config.mapping.captionMetaKey || !caption), recipe: Boolean(text) && !recipe && !config.mapping.recipeMetaKey };
    if (!caption && !write.caption) { rejected.caption++; if (row.captionFieldPresent === false) rejected.captionFieldMissing = (rejected.captionFieldMissing ?? 0) + 1; continue; }
    if (!imageUrl) { rejected.image++; continue; }
    if (!permalink) { rejected.link++; continue; }
    if (!recipe && !write.recipe) { rejected.recipe++; continue; }
    const title = (recipe?.title || row.title).slice(0, settings.titleMax);
    out.push({ wpPostId: row.id, title, slug: row.slug, caption, imageUrl, permalink, recipe: recipe ?? emptyRecipe(title), publishedAt: row.publishedAt,
      ...(write.caption || write.recipe ? { write: { article: { title: row.title, excerpt: row.excerpt ?? '', text }, ...write } } : {}) });
  }
  return out;
}

/** Autopilot (2026-11-16): read chosen recipes (past winners) by WordPress id. */
/** The row sharing the most dish words with `title` (titleWords, Jaccard), when they share at least half. */
export function closestVariant<R extends { id: string; title: string }>(title: string, rows: readonly R[]): R | null {
  const mine = new Set(titleWords(title));
  if (!mine.size) return null;
  let best: { row: R; score: number } | null = null;
  for (const row of rows) {
    const theirs = new Set(titleWords(row.title)); const shared = [...mine].filter(word => theirs.has(word)).length;
    const score = shared / new Set([...mine, ...theirs]).size;
    if (score >= 0.5 && (!best || score > best.score)) best = { row, score };
  }
  return best?.row ?? null;
}
/** An outside post is a hit to bring back from this many people reached (and 5× its Page's usual). */
export const OUTSIDE_HIT_REACH = 50_000;
const titleCache = new Map<string, { id: string | null; at: number }>();
/**
 * The site's recipe whose title is exactly this one (accents, case and punctuation aside), else its closest variant, by
 * WordPress search; the answer is kept a day so the planner, every 15 minutes, does not ask again (2026-11-22).
 */
export async function recipeByTitle(db: WpDb, config: PlanConfig, title: string, now: Date): Promise<string | null> {
  const key = recipeTitleKey(title);
  const cached = titleCache.get(key);
  if (cached && now.getTime() - cached.at < 86_400_000) return cached.id;
  const { rows } = await db.candidates({ mapping: config.mapping, order: 'newest', skipShared: false, maxAgeDays: 0, offset: 0, limit: 10, now, search: title });
  // The exact recipe when the site still has it; otherwise its closest variant (the site makes several of each hit:
  // « Camembert en croûte au bacon, doré et fondant » for « Camembert feuilleté au bacon, doré et fondant »).
  const id = rows.find(row => recipeTitleKey(row.title) === key)?.id ?? closestVariant(title, rows)?.id ?? null;
  titleCache.set(key, { id, at: now.getTime() });
  return id;
}

export async function readCandidates(db: WpDb, settings: WordpressSettings, source: Pick<SourceRow, 'siteUrl'>, config: PlanConfig, ids: readonly string[], now: Date, writer = false): Promise<Candidate[]> {
  if (!ids.length) return [];
  const { rows } = await db.candidates({ mapping: config.mapping, order: config.order, skipShared: false, maxAgeDays: 0, offset: 0, limit: ids.length, now, include: ids });
  return toCandidates(db, settings, source, config, rows, writer, { shared: 0, caption: 0, image: 0, link: 0, recipe: 0, captionFieldMissing: 0 });
}

export const commentFor = (settings: WordpressSettings, config: PlanConfig, c: Pick<Candidate, 'recipe' | 'permalink'>) =>
  renderComment(config.firstCommentTemplate, c.recipe, c.permalink, { max: settings.commentMax, mark: settings.truncationMark });
const emptyRecipe = (title: string): Recipe => ({ title, description: '', servings: '', prep: '', cook: '', total: '', ingredients: [], steps: [] });

/**
 * The caption and first comment a candidate posts with. AI writes what the post's fields left empty; a first comment
 * template that asks for lists the post does not have is refused (invalid_request), so the planner picks another post.
 */
export async function writeCandidate(ports: Pick<PlannerPorts, 'writer'>, actor: FeedActor, settings: WordpressSettings, config: PlanConfig, c: Candidate): Promise<{ caption: string; firstComment: string }> {
  if (!c.write) return { caption: c.caption, firstComment: commentFor(settings, config, c) };
  const written = await ports.writer.write(actor, c.write.article);
  const line = (text: string) => ({ text, heading: false });
  const recipe = c.write.recipe ? { ...c.recipe, description: written.description, ingredients: written.ingredients.map(line), steps: written.steps.map(line) } : c.recipe;
  const listed = (name: 'ingredients' | 'steps') => !config.firstCommentTemplate.includes(`{${name}}`) || recipe[name].length > 0;
  if (!listed('ingredients') || !listed('steps')) throw new OperationError('invalid_request', 'This post has no list or steps for the first comment template.');
  return { caption: c.write.caption ? written.caption : c.caption, firstComment: commentFor(settings, config, { ...c, recipe }) };
}

/* ----- ledger views ----- */

export type LedgerView = { reused: Map<string, Map<string, number>>; blocked: Map<string, Set<string>>; taken: Set<string>; byKey: Map<string, LedgerRow> };
export const slotKey = (targetId: string, slotAt: Date) => `${targetId}|${slotAt.getTime()}`;
export function ledgerView(rows: readonly LedgerRow[], now: Date, reuse?: { enabled: boolean; cooldownDays: number }): LedgerView {
  const reused = new Map<string, Map<string, number>>();
  const blocked = new Map<string, Set<string>>(); const taken = new Set<string>(); const byKey = new Map<string, LedgerRow>();
  const add = (page: string, id: string) => { const set = blocked.get(page) ?? new Set<string>(); set.add(id); blocked.set(page, set); };
  for (const row of rows) {
    byKey.set(slotKey(row.targetId, row.slotAt), row);
    // Recipes that failed for a slot stay away from its page even after the slot is planned with another recipe.
    for (const id of row.skipped) add(row.targetId, id);
    if (row.state === 'failed') continue;
    const published = row.publishedAt?.getTime();
    const reusable = reuse?.enabled && row.state === 'planned' && row.postId && published !== undefined && Number.isFinite(published)
      && published <= now.getTime() - reuse.cooldownDays * MS_DAY && row.slotAt.getTime() < now.getTime();
    if (reusable) {
      const dates = reused.get(row.targetId) ?? new Map<string, number>();
      dates.set(row.wpPostId, Math.max(dates.get(row.wpPostId) ?? -Infinity, published)); reused.set(row.targetId, dates);
    } else { add(row.targetId, row.wpPostId); if (row.title) add(row.targetId, recipeTitleKey(row.title)); }
    if (row.slotAt.getTime() >= now.getTime()) { taken.add(row.wpPostId); if (row.title) taken.add(recipeTitleKey(row.title)); }
  }
  return { blocked, taken, byKey, reused };
}

/** Read all retained recipe history: an old scheduled/unknown outcome is never silently made reusable. */
export async function supplyLedgerView(settings: WordpressSettings, ports: PlannerPorts, source: SourceRow, now: Date): Promise<LedgerView> {
  const config = configOf(settings, source);
  const rows = await ports.store.ledgerSince(source.id, new Date(0));
  const policy = { enabled: settings.reuse.enabled, cooldownDays: Math.max(settings.reuse.cooldownDays, config.cooldownDays) };
  const view = ledgerView(rows, now, policy);
  if (config.distinctAcrossPages) {
    // Every channel consumes the same supply; historical use must have the same scope as the days-left estimate.
    const shared = ledgerView(rows.map(row => ({ ...row, targetId: source.id })), now, policy);
    const blocked = shared.blocked.get(source.id) ?? new Set<string>();
    const reused = shared.reused.get(source.id) ?? new Map<string, number>();
    const pages = await ports.store.pages(source, settings.targetTypes, settings.maxTargets);
    for (const page of pages) { view.blocked.set(page.id, blocked); view.reused.set(page.id, reused); }
  }
  // A recipe the Page already got from another tool (its caption is the title) is not planned there again (2026-11-21).
  if (ports.store.outsideTitles) {
    const pages = await ports.store.pages(source, settings.targetTypes, settings.maxTargets);
    const outside = await ports.store.outsideTitles(pages.map(page => page.id), new Date(now.getTime() - config.cooldownDays * 86_400_000));
    for (const { targetId, title } of outside) {
      const key = recipeTitleKey(title); if (key === 'title:') continue;
      // With distinct recipes across Pages, every Page shares one set: the recipe is then kept off all of them.
      const set = view.blocked.get(targetId) ?? new Set<string>(); set.add(key); view.blocked.set(targetId, set);
    }
  }
  return view;
}

/* ----- one source ----- */

export type SourceOutcome = { excludedNames?: string[]; sourceId: string; planned: number; failed: number; uncertain: number; unfilled: number; slots: number; pages: number; excludedPages: number; scanned: number; reason?: string; candidates?: number; rejected?: ScanRejections;
  /** Photos generated in this run (2026-11-19), and the last reason one could not be. */
  generated?: Array<{ targetId: string; title: string; appeal: number | null }>; photoProblem?: string };
export type Ctx = {
  settings: WordpressSettings; ports: PlannerPorts; db: WpDb; budget: { left: number }; now: Date;
  /** Manual retry: only these slots (see slotKey) are planned, and a failed slot is revived even past its attempt cap. */
  retry?: ReadonlySet<string>;
  /** Wall-clock end (epoch ms) for a run a member waits on; slots left then stay empty for the next run. */
  deadline?: number;
  /** A member's own choice of recipe for a slot (slotKey → WordPress post id), 2026-11-15. */
  force?: ReadonlyMap<string, string>;
  /** Self-healing (2026-11-16): slots whose post failed to publish (slotKey → when the replacement goes out). */
  makeup?: ReadonlyMap<string, Date>;
};
/** Reason on a slot a member chose to leave empty: never filled again until they fill it themselves (2026-11-15). */
export const LEFT_EMPTY = 'left_empty';
const DEFINITIVE = new Set(['invalid_request', 'forbidden', 'unauthorized', 'unavailable', 'conflict', 'not_found']);
const AUTHORITY = new Set(['forbidden', 'unauthorized', 'unavailable']);
const safeName = (slug: string) => `${slug.replace(/[^A-Za-z0-9-]/g, '').slice(0, 80) || 'recipe'}-fb.jpg`;

export const configOf = (settings: WordpressSettings, source: Pick<SourceRow, 'config'>): PlanConfig => resolveConfig(settings.defaults, source.config, patchLimits(settings));

/**
 * Everything the autopilot needs to choose (2026-11-16): past results and weather once per run, the past winners that
 * may come back, the channels' existing posts for the variety guard, and AI ratings for the recipes read.
 */
async function prepareChoosing(ctx: Ctx, source: SourceRow, config: PlanConfig, pilot: AutopilotSettings, scoring: ScoringPorts, view: LedgerView, pages: ReadonlyArray<{ id: string }>, needCount: number, writer: boolean, usable: (found: Candidate[]) => Candidate[], actor: FeedActor) {
  const { settings, now } = ctx;
  const [outcomes, weather] = await Promise.all([
    scoring.outcomes(source.id, new Date(now.getTime() - 365 * 86_400_000)).catch(() => []),
    pilot.moments.rules.includes('weather') ? scoring.weather(pilot.moments.latitude, pilot.moments.longitude, config.timezone).catch(() => new Map<string, number>()) : Promise.resolve(new Map<string, number>()),
  ]);
  // What works on each channel (2026-11-18): its stored memory (content, time, caption; reach, reactions, comments,
  // shares), or, before a Page has one, what its own recent posts show.
  const memories = await scoring.memories?.(source.id).catch(() => new Map()) ?? new Map();
  const model = memories.size ? memoryModel(memories) : null;
  const recent = pageLearning(outcomes, now);
  // A strong recipe whose photo is weak is no longer passed over while a new photo can be generated for it
  // (2026-11-19): its photo then counts as average, and the planner generates one (see ./wordpress-photos.ts).
  let replacesPhoto: ((targetId: string | null, rating: Rating) => boolean) | undefined;
  if (writer && ctx.ports.generatePhotos) {
    const photos = await import('./wordpress-photos').catch(() => null);
    const left = photos ? await photos.generationsLeft(source.workspaceId, now).catch(() => 0) : 0;
    if (photos && left > 0) replacesPhoto = (targetId, rating) => photoWeak(model?.photoValue(targetId, rating.traits) ?? null, rating.photo) && (rating.hook ?? 0) >= photos.STRONG_HOOK && (!targetId || model?.generatedPhotosOk(targetId) !== false);
  }
  // What the biggest hits share counts on every Page (2026-11-19, owner's choice), on top of each Page's own memory.
  const hits = hitWords(await import('./wordpress-memory').then(m => m.hitPosts(pages.map(page => page.id), now)).catch(() => []));
  const history = (targetId: string | null, title: string, kind: RecipeKind | null, slotAt: Date | null) => {
    const own = (model && targetId && memories.has(targetId) ? model.contentValue(targetId, title, kind, slotAt, config.timezone) : null) ?? recent(targetId, title);
    const boost = hitBoost(hits, title);
    return own === null ? (boost > 1 ? boost : null) : own * boost;
  };
  // Testing ground (2026-11-21, owner's choice): every Page but the two with the biggest usual reach explores new dish
  // families; a winner there moves up to the big Pages through the radar (wordpress-radar.ts spreadTargets).
  const big = model ? new Set(model.bigPages(2)) : null;
  const explore = model && big?.size ? { pages: new Set(pages.map(page => page.id).filter(id => !big.has(id))), novelty: (title: string) => model.novelty(title) } : null;
  // Past winners: the best tenth of published recipes (and clearly above usual), back after the cooldown.
  const best = new Map<string, number>();
  for (const o of outcomes) best.set(o.wpPostId, Math.max(best.get(o.wpPostId) ?? 0, o.relative));
  const ranked = [...best].filter(([, rel]) => rel >= 1.3).sort((a, b) => b[1] - a[1]);
  const winnerIds = pilot.evergreen.enabled && pilot.evergreen.share > 0 ? ranked.slice(0, Math.max(1, Math.ceil(best.size / 10))).slice(0, 30).map(([id]) => id) : [];
  const winners = winnerIds.length ? usable(await readCandidates(ctx.db, settings, source, config, winnerIds, now, writer).catch(() => [])) : [];
  // A winner is blocked on a channel only while it was posted there within the cooldown.
  const cutoff = now.getTime() - pilot.evergreen.cooldownDays * 86_400_000;
  const lastOn = new Map<string, number>();
  for (const row of view.byKey.values()) if (row.state === 'planned') { const key = `${row.targetId}|${row.wpPostId}`; lastOn.set(key, Math.max(lastOn.get(key) ?? 0, row.slotAt.getTime())); }
  const blocked = new Map([...view.blocked].map(([page, set]) => [page, new Set(set)]));
  for (const w of winners) for (const page of pages) {
    const last = lastOn.get(`${page.id}|${w.wpPostId}`);
    if (last !== undefined && last < cutoff) { blocked.get(page.id)?.delete(w.wpPostId); blocked.get(page.id)?.delete(recipeTitleKey(w.title)); }
  }
  // The owner's own biggest hits come back too (2026-11-22): found on the site by their title, on the Page where they
  // were hits, after the same rest as the autopilot's winners.
  if (pilot.evergreen.enabled && pilot.evergreen.share > 0 && ctx.ports.store.outsideHits) {
    const hits = await ctx.ports.store.outsideHits(pages.map(page => page.id), new Date(cutoff), OUTSIDE_HIT_REACH, 10).catch(() => []);
    const found = new Map<string, string>();
    for (const hit of hits) { const id = await recipeByTitle(ctx.db, config, hit.title, now).catch(() => null); if (id) found.set(`${hit.targetId}|${id}`, id); }
    const extra = [...new Set(found.values())].filter(id => !winners.some(w => w.wpPostId === id));
    if (extra.length) winners.push(...usable(await readCandidates(ctx.db, settings, source, config, extra, now, writer).catch(() => [])));
    for (const key of found.keys()) {
      const [pageId, id] = key.split('|') as [string, string];
      const w = winners.find(item => item.wpPostId === id); const last = lastOn.get(key);
      if (w && (last === undefined || last < cutoff)) { blocked.get(pageId)?.delete(id); blocked.get(pageId)?.delete(recipeTitleKey(w.title)); }
    }
  }
  const winnerQuota = Math.floor(needCount * pilot.evergreen.share / 100);
  const preferredStyle = bestStyle(outcomes).style;
  return {
    winners, blocked, preferredStyle, model,
    async picker(candidates: Candidate[]) {
      const ids = candidates.map(c => c.wpPostId);
      let ratings = await scoring.ratings(source.id, ids).catch(() => new Map());
      // AI rates what it has not seen (titles in a batch, then the photos of the most promising), once per recipe.
      if (writer) {
        const unrated = candidates.filter(c => !ratings.get(c.wpPostId)?.kind);
        if (unrated.length) { await scoring.rate(actor, source, unrated.map(c => ({ id: c.wpPostId, title: c.title }))).catch(() => undefined); ratings = await scoring.ratings(source.id, ids).catch(() => ratings); }
      }
      const kindOfRow = (row: LedgerRow): RecipeKind => (row.kind as RecipeKind | null | undefined) ?? ratings.get(row.wpPostId)?.kind ?? guessKind(row.title);
      const timeline = new Map<string, Array<{ at: number; kind: RecipeKind }>>();
      for (const row of view.byKey.values()) if (row.state !== 'failed') timeline.set(row.targetId, [...(timeline.get(row.targetId) ?? []), { at: row.slotAt.getTime(), kind: kindOfRow(row) }]);
      const picker = makePicker({ pilot, timeZone: config.timezone, ratings, history, weather, timeline, winners: new Set(winners.map(w => w.wpPostId)), winnerQuota, candidates, replacesPhoto, ...(explore ? { explore } : {}),
        photoValue: (targetId, traits) => model?.photoValue(targetId, traits) ?? null });
      // The photos of the most promising candidates not seen yet are read before choosing (2026-11-18), so what each
      // Page's memory learned about photos counts in this run's choice; the picker is built again with them.
      if (writer) {
        const soon = new Date(now.getTime() + 86_400_000);
        const unseen = candidates.filter(c => { const r = ratings.get(c.wpPostId); return !r?.traits || (r.photoVersion ?? 1) < PHOTO_VERSION; }).sort((a, b) => picker.scoreAt(b, soon) - picker.scoreAt(a, soon)).slice(0, PHOTO_BATCH);
        if (unseen.length && await scoring.ratePhotos(actor, source, unseen.map(c => ({ id: c.wpPostId, imageUrl: c.imageUrl }))).catch(() => 0)) {
          ratings = await scoring.ratings(source.id, ids).catch(() => ratings);
          return makePicker({ pilot, timeZone: config.timezone, ratings, history, weather, timeline, winners: new Set(winners.map(w => w.wpPostId)), winnerQuota, candidates, replacesPhoto, ...(explore ? { explore } : {}),
        photoValue: (targetId, traits) => model?.photoValue(targetId, traits) ?? null });
        }
      }
      return picker;
    },
  };
}

/**
 * Fill every unplanned slot of the horizon, one page at a time, with a different recipe, through Publishing's
 * normal scheduling service. Each slot is claimed in the ledger first (unique per source, page and time), so
 * a restart, a second worker or a retry can never plan the same slot twice.
 */
export async function planSource(ctx: Ctx, source: SourceRow, auth: FeedAuthorization): Promise<SourceOutcome> {
  const { settings, ports, now } = ctx;
  const config = configOf(settings, source);
  const out: SourceOutcome = { sourceId: source.id, planned: 0, failed: 0, uncertain: 0, unfilled: 0, slots: 0, pages: 0, excludedPages: 0, scanned: 0 };
  await ports.store.expireStale(source.id, new Date(now.getTime() - settings.claimLeaseSeconds * 1000));
  await ports.store.releaseDrafted?.(source.id, now).catch(() => 0);

  const candidatePages = await ports.store.pages(source, settings.targetTypes, settings.maxTargets);
  const pages: Array<{ id: string; name: string }> = [];
  for (const page of candidatePages) {
    try { await ports.validateTarget(auth.actor, page.id); pages.push(page); } catch { out.excludedPages += 1; (out.excludedNames ??= []).push(page.name); }
  }
  out.pages = pages.length;
  const pageOrder = new Map(pages.map((page, index) => [page.id, index]));
  // A channel posting at its own times (its own or learned, each on its own 5-minute mark) is not offset again (2026-11-16).
  const learned = autopilotOf(config.autopilot);
  const ownTimes = (targetId: string) => Boolean(config.channels?.[targetId]?.slots?.length) || (learned.bestTimes.enabled && Boolean(learned.learnedTimes?.[targetId]?.length));
  const staggered = (slotAt: Date, targetId: string) => ownTimes(targetId) ? slotAt : new Date(slotAt.getTime() + (pageOrder.get(targetId) ?? 0) * (Number.isFinite(settings.pageStaggerMinutes) ? settings.pageStaggerMinutes : 0) * 60_000);
  if (!pages.length) return { ...out, reason: 'no_pages' };

  // Each channel posts with its own settings where it has them (2026-11-15): times, days, order, first comment, or paused.
  const own = new Map(pages.map(page => [page.id, channelConfig(config, page.id)]));
  const of = (targetId: string) => own.get(targetId) ?? channelConfig(config, targetId);
  const pairs: Array<{ slotAt: Date; page: { id: string; name: string } }> = [];
  for (const page of pages) {
    const mine = of(page.id);
    if (mine.paused) continue;
    for (const slotAt of slotInstants({ now, slots: mine.slots, timezone: config.timezone, horizonDays: config.horizonDays, leadMinutes: settings.minLeadMinutes, ...(mine.weekdays ? { weekdays: mine.weekdays } : {}) })) pairs.push({ slotAt, page });
  }
  // A slot a member retries or chooses a recipe for is planned at its own time, even when the channel's times changed
  // since it was first planned (2026-11-16: « Another recipe » on an older time left it empty).
  for (const key of new Set([...(ctx.retry ?? []), ...(ctx.force?.keys() ?? [])])) {
    const [targetId, ms] = key.split('|'); const page = pages.find(item => item.id === targetId);
    const at = new Date(Number(ms));
    if (page && !of(page.id).paused && at.getTime() > now.getTime() && !pairs.some(pair => pair.page.id === page.id && pair.slotAt.getTime() === at.getTime())) pairs.push({ slotAt: at, page });
  }
  // A slot whose post failed keeps its identity and gets a replacement published shortly (self-healing).
  for (const key of ctx.makeup?.keys() ?? []) {
    const [targetId, ms] = key.split('|'); const page = pages.find(item => item.id === targetId);
    if (page && !of(page.id).paused) pairs.push({ slotAt: new Date(Number(ms)), page });
  }
  pairs.sort((a, b) => a.slotAt.getTime() - b.slotAt.getTime() || (pageOrder.get(a.page.id) ?? 0) - (pageOrder.get(b.page.id) ?? 0));
  const view = await supplyLedgerView(settings, ports, source, now);
  // Times changed (by a member or the autopilot) never double a day already planned (2026-11-16): a new time joins
  // that day only when it is at least the autopilot gap away from its posts and the day still has room.
  const gapMs = autopilotOf(config.autopilot).bestTimes.gapMinutes * 60_000;
  const dayKey = (targetId: string, at: Date) => `${targetId}|${instantToWall(at, config.timezone).date}`;
  const held = new Map<string, number[]>();
  for (const row of view.byKey.values()) {
    if (row.state === 'failed' && row.reason !== LEFT_EMPTY) continue;
    const key = dayKey(row.targetId, row.slotAt); held.set(key, [...(held.get(key) ?? []), row.slotAt.getTime()]);
  }
  const fitting = pairs.filter(({ slotAt, page }) => {
    if (view.byKey.has(slotKey(page.id, slotAt))) return true;
    const key = dayKey(page.id, slotAt); const day = held.get(key);
    if (!day?.length) return true;
    if (day.some(at => Math.abs(at - slotAt.getTime()) < gapMs) || day.length >= of(page.id).slots.length) return false;
    day.push(slotAt.getTime()); return true;
  });
  pairs.splice(0, pairs.length, ...fitting);
  out.slots = new Set(pairs.map(pair => pair.slotAt.getTime())).size;

  const needs: SlotNeed[] = []; const reviving = new Map<string, LedgerRow>();
  for (const { slotAt, page } of pairs) {
    const key = slotKey(page.id, slotAt);
    if (ctx.retry && !ctx.retry.has(key)) continue;
    const row = view.byKey.get(key);
    // A slot a member left empty stays empty, even for « Plan failed times again ».
    if (row?.reason === LEFT_EMPTY) continue;
    if (row && !(row.state === 'failed' && (ctx.retry !== undefined || row.skipped.length < settings.maxSlotAttempts))) continue;
    needs.push({ targetId: page.id, slotAt, ...(row ? { avoid: new Set(row.skipped) } : {}) });
    if (row) reviving.set(slotKey(page.id, slotAt), row);
  }
  const todo = needs.slice(0, Math.max(0, ctx.budget.left));
  if (!todo.length) return { ...out, reason: needs.length ? 'budget' : 'complete' };

  const writer = await ports.writer.available(source.workspaceId).catch(() => false);
  // Recipes a member excluded are never candidates; a forced slot takes exactly the recipe chosen for it (2026-11-15).
  const excluded = new Set((config.excluded ?? []).map(item => item.id));
  const usable = (found: Candidate[]) => excluded.size ? found.filter(c => !excluded.has(c.wpPostId)) : found;
  // Channels reading the library in a different order get their own scan; recipes picked for one group are taken for the next.
  const groups = new Map<'newest' | 'oldest', SlotNeed[]>();
  for (const need of todo) { const order = of(need.targetId).order; groups.set(order, [...(groups.get(order) ?? []), need]); }
  const taken = new Set(view.taken);
  const assignments: Array<{ targetId: string; slotAt: Date; candidate: Candidate }> = [];
  const chosenScores = new Map<string, { score: number; kind: string }>();
  // First lines of captions written in this run, newest first, so channels never open alike.
  const openings: string[] = learned.captions.enabled && ports.captions?.recent ? await ports.captions.recent(source.id, 10).catch(() => []) : [];
  let readable = 0; let captionMissing = 0; let recipeMissing = 0; let unfilled = 0;
  out.candidates = 0; out.rejected = { shared: 0, caption: 0, image: 0, link: 0, recipe: 0, captionFieldMissing: 0 };
  // Autopilot choosing (2026-11-16): scores, best hours first, variety, past winners. Off without scoring ports.
  const pilot = autopilotOf(config.autopilot);
  const scoring = pilot.score.enabled ? ports.scoring : undefined;
  const prep = scoring ? await prepareChoosing(ctx, source, config, pilot, scoring, view, pages, todo.length, writer, usable, auth.actor).catch(() => null) : null;
  for (const [order, group] of groups) {
    const groupConfig = { ...config, order };
    const forcedIds = ctx.force ? [...new Set(group.flatMap(need => ctx.force!.get(slotKey(need.targetId, need.slotAt)) ?? []))] : [];
    const autoTodo = ctx.force ? group.filter(need => !ctx.force!.has(slotKey(need.targetId, need.slotAt))) : group;
    // With scoring, a wider choice is read: the best of the pool is planned, not just the next in line.
    const pool = prep ? Math.min(settings.candidateMaxScan, Math.max(60, autoTodo.length * 3)) : 0;
    const scan = await scanCandidates(ctx.db, settings, source, groupConfig, now, found => forcedIds.length
      ? forcedIds.every(id => found.some(c => c.wpPostId === id))
      : !settings.reuse.enabled && usable(found).length >= pool && allocateRecipes({ needs: autoTodo, candidates: usable(found), blocked: view.blocked, taken, reused: view.reused, distinct: config.distinctAcrossPages }).unfilled === 0, writer);
    scan.candidates = usable(scan.candidates);
    // A chosen recipe beyond the scan (an older hit the radar spreads, an older recipe a member picks) is read by its id,
    // so the slot whose post was cancelled for it never stays empty (2026-11-16).
    const unread = forcedIds.filter(id => !scan.candidates.some(c => c.wpPostId === id));
    if (unread.length) scan.candidates = [...scan.candidates, ...usable(await readCandidates(ctx.db, settings, source, groupConfig, unread, now, writer).catch(() => []))];
    if (prep) scan.candidates = [...scan.candidates, ...prep.winners.filter(w => !scan.candidates.some(c => c.wpPostId === w.wpPostId))];
    const picker = prep ? await prep.picker(scan.candidates) : null;
    out.scanned += scan.scanned; out.candidates += scan.candidates.length;
    for (const key of Object.keys(out.rejected) as Array<keyof ScanRejections>) out.rejected[key] = (out.rejected[key] ?? 0) + (scan.rejected[key] ?? 0);
    readable += scan.scanned - scan.rejected.shared; captionMissing += scan.rejected.captionFieldMissing ?? 0; recipeMissing += scan.rejected.recipe;
    const groupForced: Array<{ targetId: string; slotAt: Date; candidate: Candidate }> = [];
    for (const need of group) {
      const id = ctx.force?.get(slotKey(need.targetId, need.slotAt));
      if (!id) continue;
      const candidate = scan.candidates.find(c => c.wpPostId === id);
      if (candidate) groupForced.push({ targetId: need.targetId, slotAt: need.slotAt, candidate });
    }
    const automatic = allocateRecipes({ needs: picker ? picker.orderNeeds(autoTodo) : autoTodo, candidates: scan.candidates, allowReuse: scan.exhausted, blocked: prep?.blocked ?? view.blocked, taken, reused: view.reused, distinct: config.distinctAcrossPages,
      ...(picker ? { rank: picker.rank, fits: picker.fits, onAssign: picker.onAssign } : {}) });
    if (picker) for (const f of groupForced) chosenScores.set(slotKey(f.targetId, f.slotAt), { score: picker.scoreAt(f.candidate, f.slotAt, f.targetId), kind: picker.kindOf(f.candidate) });
    if (picker) for (const a of automatic.assignments) { const c = picker.chosen(a.targetId, a.slotAt); if (c) chosenScores.set(slotKey(a.targetId, a.slotAt), c); }
    for (const { candidate } of [...groupForced, ...automatic.assignments]) { taken.add(candidate.wpPostId); if (candidate.title) taken.add(recipeTitleKey(candidate.title)); }
    assignments.push(...groupForced, ...automatic.assignments);
    unfilled += automatic.unfilled + (group.length - autoTodo.length - groupForced.length);
  }
  // Every post came back without the caption field itself: credentials or the REST exposure of that field failed, not the content.
  if (readable > 0 && captionMissing === readable) out.reason = 'caption_field_missing';
  else if (readable > 0 && !writer && !config.mapping.recipeMetaKey && recipeMissing === readable) out.reason = 'needs_ai';
  out.unfilled = unfilled + (needs.length - todo.length);

  let generationsLeft: number | undefined;
  for (const [index, { targetId, slotAt, candidate: c }] of assignments.entries()) {
    if (ctx.budget.left <= 0) break;
    if (ctx.deadline !== undefined && Date.now() >= ctx.deadline) { out.unfilled += assignments.length - index; out.reason = 'time_limit'; break; }
    const previous = reviving.get(slotKey(targetId, slotAt));
    const priorSkipped = previous?.skipped ?? [];
    const chosenScore = chosenScores.get(slotKey(targetId, slotAt));
    const claimId = await ports.store.claim({ workspaceId: source.workspaceId, sourceId: source.id, targetId, wpPostId: c.wpPostId, slotAt, title: c.title, permalink: c.permalink, skipped: priorSkipped, ...(chosenScore ? { score: chosenScore.score, kind: chosenScore.kind } : {}) });
    if (!claimId) continue;
    ctx.budget.left -= 1;
    let written: { caption: string; firstComment: string };
    try { written = await writeCandidate(ports, auth.actor, settings, of(targetId), c); }
    catch (error) {
      // Nothing was created: the slot fails and is planned again, without this post when it has nothing to write from.
      const code = error instanceof OperationError ? error.code : 'unknown';
      await ports.store.settle(source.workspaceId, claimId, { state: 'failed', reason: `writing:${code}`, skipped: code === 'invalid_request' ? [...priorSkipped, c.wpPostId] : priorSkipped }).catch(() => undefined);
      out.failed += 1;
      if (AUTHORITY.has(code)) return { ...out, reason: code };
      // The AI hourly limit or monthly budget (2026-11-23): every later slot would be claimed and fail the same way
      // (5 on 20–21 Nov). The run stops here; the slots stay open and the next run fills them.
      if (code === 'conflict') { out.unfilled += assignments.length - index - 1; out.reason = 'ai_limit'; break; }
      continue;
    }
    // Autopilot (2026-11-16): the channel's own caption in its voice and a hook style, and a call to action on the comment.
    let style: HookStyle | null = null;
    const key = slotKey(targetId, slotAt);
    // Title-only test (2026-11-21): the outside posts on « Recettes - Faciles » carry only the recipe's title and reach far more.
    if (of(targetId).captionTitle && c.title.trim()) written = { ...written, caption: c.title.trim().slice(0, settings.textMax) };
    else if (pilot.captions.enabled && writer && ports.captions) {
      const avoid = openings.slice(0, 10);
      // Each Page's own lessons (2026-11-18): its best hook style and the caption habits that work there.
      const tips = prep?.model?.captionTips(targetId) ?? [];
      const question = tips.some(tip => tip.code === 'qend') ? true : tips.some(tip => tip.code === 'noqend') ? false : pilot.captions.question;
      const pick = styleFor(key, prep?.model?.bestStyle(targetId) ?? prep?.preferredStyle ?? null, pilot.hooks.enabled ? pilot.hooks.share : 0);
      const wall = instantToWall(ctx.makeup?.get(slotKey(targetId, slotAt)) ?? staggered(slotAt, targetId), config.timezone);
      const { system, prompt } = captionPrompt({ when: postingMoment(wall.date, Number(wall.time.slice(0, 2))), channel: pages.find(page => page.id === targetId)?.name ?? '', voice: voiceFor(pilot.captions.voice, pageOrder.get(targetId) ?? 0), style: pick.style, question, guidance: captionGuidance(tips.filter(tip => tip.code !== 'qend' && tip.code !== 'noqend')), emoji: pilot.captions.emoji,
        title: c.title, caption: written.caption, ingredients: c.recipe.ingredients.filter(line => !line.heading).map(line => line.text), avoid });
      try {
        let clean = cleanCaption(await ports.captions.write(auth.actor, system, prompt), settings.textMax);
        // Same first two words as a recent caption: written once more, told which words to avoid.
        const echo = clean ? opensLike(clean, avoid) : null;
        if (clean && echo) clean = cleanCaption(await ports.captions.write(auth.actor, `${system}\nDo not start with « ${echo} ».`, prompt).catch(() => ''), settings.textMax) ?? clean;
        // A worn-out phrase (2026-11-21): written once more, told which one; kept only when the new one is free of it.
        const worn = clean ? clicheIn(clean) : null;
        if (clean && worn) { const again = cleanCaption(await ports.captions.write(auth.actor, `${system}\nDo not write « ${worn} » or anything like it.`, prompt).catch(() => ''), settings.textMax); if (again && !clicheIn(again)) clean = again; }
        if (clean) { written = { ...written, caption: clean }; style = pick.style; openings.unshift(clean.split('\n')[0]!.slice(0, 90)); } }
      catch { /* over the AI limit or unavailable: the recipe's own caption goes out */ }
    }
    // A channel set to a plain first comment (2026-11-23) posts its template as is, without the call to action.
    if (pilot.comment.enabled && !of(targetId).plainComment) written = { ...written, firstComment: withCta(written.firstComment, ctaFor(pilot.comment.cta, key), settings.commentMax) };
    let postId: string;
    let imageSource: 'site' | 'generated' = 'site';
    try {
      const mediaActor = { userId: auth.actor.userId, workspaceId: source.workspaceId };
      // A weak recipe photo is replaced by a generated one (2026-11-19, see ./wordpress-photos.ts); any problem, and the recipe's own photo goes out.
      let image: { mediaId: string } | null = null;
      if (writer && ports.generatePhotos && prep?.model?.generatedPhotosOk(targetId) !== false) {
        try {
          const photos = await import('./wordpress-photos');
          generationsLeft ??= await photos.generationsLeft(source.workspaceId, now);
          const rated = generationsLeft > 0 ? await photos.photoAppeal(source.id, c.wpPostId) : null;
          const appeal = rated?.photo ?? null;
          if (rated && photoWeak(prep?.model?.photoValue(targetId, rated.traits) ?? null, appeal)) {
            generationsLeft -= 1;
            image = await photos.generateRecipePhoto(mediaActor, { title: c.title, ingredients: c.recipe.ingredients.filter(line => !line.heading).map(line => line.text),
              steps: c.recipe.steps.filter(line => !line.heading).map(line => line.text), fileName: safeName(c.slug), settings: settings.image, wpPostId: c.wpPostId }, ports.image);
            imageSource = 'generated';
            (out.generated ??= []).push({ targetId, title: c.title.slice(0, 120), appeal });
          }
        } catch (error) { image = null; out.photoProblem = String(error instanceof Error ? error.message : error).slice(0, 200); }
      }
      image ??= await prepareRecipeImage(ports.image, { actor: mediaActor, url: c.imageUrl, fileName: safeName(c.slug), settings: settings.image });
      const post = await ports.createPost(auth.actor, {
        // The slot keeps its identity (ledger key); only the publish time is offset per Page, so Pages never post in lockstep.
        message: written.caption, firstComment: written.firstComment, targetIds: [targetId], scheduledAt: ctx.makeup?.get(slotKey(targetId, slotAt)) ?? staggered(slotAt, targetId),
        media: [{ kind: 'image', url: `media:${image.mediaId}`, altText: c.title.slice(0, settings.altMax) }], firstCommentDelayMinutes: pilot.comment.enabled ? pilot.comment.delayMinutes : of(targetId).firstCommentDelayMinutes,
      });
      postId = post.id;
    } catch (error) {
      const code = error instanceof OperationError ? error.code : error instanceof RecipeImageError ? 'image' : 'unknown';
      const recipeFault = error instanceof RecipeImageError || (error instanceof OperationError && error.code === 'invalid_request');
      if (error instanceof RecipeImageError || (error instanceof OperationError && DEFINITIVE.has(error.code))) {
        await ports.store.settle(source.workspaceId, claimId, { state: 'failed', reason: error instanceof RecipeImageError ? error.code : code, skipped: recipeFault ? [...priorSkipped, c.wpPostId] : priorSkipped }).catch(() => undefined);
        out.failed += 1;
        if (error instanceof OperationError && AUTHORITY.has(error.code)) return { ...out, reason: error.code };
      } else {
        // The post may or may not exist; the slot stays consumed and is never retried automatically.
        await ports.store.settle(source.workspaceId, claimId, { state: 'uncertain', reason: 'unconfirmed' }).catch(() => undefined);
        out.uncertain += 1;
      }
      continue;
    }
    try { await ports.store.settle(source.workspaceId, claimId, { state: 'planned', postId, imageSource, ...(style ? { style } : {}) }); out.planned += 1; }
    catch { out.uncertain += 1; /* the claim stays; it turns uncertain when its lease ends */ }
  }
  return out;
}

/* ----- the worker entry ----- */

export type RecipePlanSummary = { reason?: 'disabled' | 'misconfigured' | 'database_unavailable'; sources: number; planned: number; failed: number; uncertain: number; unfilled: number; outcomes: SourceOutcome[] };
const emptySummary = (reason?: RecipePlanSummary['reason']): RecipePlanSummary => ({ ...(reason ? { reason } : {}), sources: 0, planned: 0, failed: 0, uncertain: 0, unfilled: 0, outcomes: [] });
const totals = (summary: RecipePlanSummary, o: SourceOutcome) => { summary.outcomes.push(o); summary.planned += o.planned; summary.failed += o.failed; summary.uncertain += o.uncertain; summary.unfilled += o.unfilled; };
export const recipeSummaryRecord = (o: SourceOutcome, at: Date): Record<string, unknown> => ({ at: at.toISOString(), planned: o.planned, failed: o.failed, uncertain: o.uncertain, unfilled: o.unfilled, slots: o.slots, pages: o.pages, excludedPages: o.excludedPages, scanned: o.scanned, ...(o.candidates !== undefined ? { candidates: o.candidates } : {}), ...(o.rejected ? { rejected: o.rejected } : {}), ...(o.reason ? { reason: o.reason } : {}) });

export const NEEDS_AI_MESSAGE = 'These posts publish no structured recipe data. Turn on AI for this workspace so it writes the caption and the first comment from each post, or set a recipe field.';
/** Explains a run where WordPress returned no caption field at all; the usual cause is the saved credential, so say which case applies. */
export function captionFieldMessage(scanned: number, field: string, credential: string | null): string {
  const token = credential?.trim() ?? '';
  // WordPress returns only meta registered for the REST API (show_in_rest), whatever the credential.
  const cause = !token
    ? `The field is probably not registered for the REST API: register "${field}" with show_in_rest on the WordPress site (register_post_meta). If it is protected, also save "username:application-password" in the recipe source settings.`
    : /^[a-z][a-z0-9+.-]*:\/\//i.test(token)
      ? 'The saved WordPress credential is a database address from the former direct connection, so it is not sent. Replace it with "username:application-password" (WordPress › Users › Profile › Application passwords).'
      : `Check that "${field}" is registered with show_in_rest on the WordPress site and that the saved application password is still valid.`;
  return `WordPress returned none of the ${scanned} recipes with the field "${field}". ${cause} Or leave the caption, image and recipe fields empty ("Use the post itself") to plan from each post's featured image and text, written into a post by AI.`;
}

/** The blog's own saved credential in clear, or null when none is saved or it cannot be decrypted. */
export function sourceCredential(source: Pick<SourceRow, 'apiCredential'>): string | null {
  if (!source.apiCredential) return null;
  try { return decryptSecret(source.apiCredential); } catch { return null; }
}

export async function openDatabase(ports: PlannerPorts, settings: WordpressSettings, source: Pick<SourceRow, 'siteUrl' | 'apiCredential'>): Promise<WpDb | null> {
  const siteUrl = (source.siteUrl || settings.siteUrl || '').trim();
  if (!siteUrl) return null;
  const apiToken = sourceCredential(source);
  try {
    return await ports.openDb({
      siteUrl,
      apiToken,
      uploadsPath: settings.uploadsPath,
      connectTimeoutMs: settings.db.connectTimeoutMs,
      queryTimeoutMs: settings.db.queryTimeoutMs,
    });
  } catch {
    return null;
  }
}

/**
 * Automatic planning, run inside the shared worker job. Enabled sources act as the oldest active workspace owner
 * whose current plan and grants allow the feature (the workspace-owner worker policy); one source's failure never
 * stops the others, and a per-run budget bounds the posts created.
 */
export async function runRecipePlanning(overrides: Partial<PlannerPorts> & { autopilot?: import('./wordpress-autopilot').AutopilotPorts; radar?: import('./wordpress-radar').RadarPorts } = {}, loaded?: WordpressSettings): Promise<RecipePlanSummary> {
  let settings: WordpressSettings;
  try { settings = loaded ?? await loadWordpressSettings(); } catch { return emptySummary('misconfigured'); }
  if (!settings.enabled) return emptySummary('disabled');
  const ports = { ...defaultPlannerPorts(), ...overrides };
  const sources = await ports.store.enabledSources(settings.maxSourcesPerRun);
  const summary = emptySummary(); summary.sources = sources.length;
  if (!sources.length) return summary;
  const now = ports.now();
  const budget = { left: settings.runBudget };
  for (const source of sources) {
    if (budget.left <= 0) break;
    const db = await openDatabase(ports, settings, source);
    if (!db) {
      await ports.store.recordRun(source.workspaceId, source.id, { at: now, error: 'The recipe library could not be reached.', summary: { at: now.toISOString(), reason: 'database_unavailable' } }).catch(() => undefined);
      continue;
    }
    try {
      const auth = await ports.qualify(source.workspaceId);
      if (!auth) {
        await ports.store.recordRun(source.workspaceId, source.id, { at: now, error: 'No active owner is allowed to plan posts for this workspace.', summary: { at: now.toISOString(), reason: 'no_qualifying_owner' } });
        totals(summary, { sourceId: source.id, planned: 0, failed: 0, uncertain: 0, unfilled: 0, slots: 0, pages: 0, excludedPages: 0, scanned: 0, reason: 'no_qualifying_owner' });
        continue;
      }
      // Autopilot (2026-11-16): learn each channel's best times, replace posts that failed to publish, log what it did.
      const autopilot = await import('./wordpress-autopilot');
      const { autopilotOf } = await import('../wordpress/autopilot');
      const pilot = autopilotOf(configOf(settings, source).autopilot);
      const entries: import('../wordpress/autopilot').AutopilotLogEntry[] = [];
      let makeup: Map<string, Date> | undefined;
      try {
        await autopilot.learnBestTimes(settings, source, await ports.store.pages(source, settings.targetTypes, settings.maxTargets), now, overrides.autopilot);
        // Each Page's memory learns its newly settled posts before this run chooses (2026-11-18).
        if (!overrides.autopilot) await import('./wordpress-memory').then(async memory => memory.updatePageMemories(source, await ports.store.pages(source, settings.targetTypes, settings.maxTargets), configOf(settings, source).timezone, now)).catch(() => 0);
        if (pilot.healing.replaceFailed) {
          // Interrupted runs: settle their upcoming slots with proof, so the channel is planned again (2026-11-16).
          const healed = await autopilot.healStranded(source.id, now, overrides.autopilot).catch(() => ({ reconciled: 0, released: 0, titles: [] as string[] }));
          for (const title of healed.titles) entries.push({ at: now.toISOString(), kind: 'healing', text: `« ${title.slice(0, 120)} » was left unsure by an interrupted run and never created; its time is planned again.`, code: 'stranded', params: { title: title.slice(0, 120) } });
          // A freed slot at a time the channel no longer uses: refilled at its next free time when its day runs short (2026-11-17).
          const healConfig = configOf(settings, source);
          const healPages = await ports.store.pages(source, settings.targetTypes, settings.maxTargets);
          const refills = autopilot.shortDayRefills({ rows: await ports.store.ledgerSince(source.id, new Date(now.getTime() - 2 * 86_400_000)), now, timezone: healConfig.timezone,
            minLeadMinutes: settings.minLeadMinutes, gapMinutes: pilot.bestTimes.gapMinutes, window: pilot.bestTimes.window, maxAttempts: settings.maxSlotAttempts,
            timesFor: id => healPages.some(page => page.id === id) ? channelConfig(healConfig, id) : null });
          for (const { row, at } of refills) {
            (makeup ??= new Map()).set(slotKey(row.targetId, row.slotAt), at);
            const time = instantToWall(at, healConfig.timezone).time;
            entries.push({ at: now.toISOString(), kind: 'healing', channelId: row.targetId, channelName: healPages.find(page => page.id === row.targetId)?.name.slice(0, 200), text: `« ${row.title.slice(0, 120)} » never went out after an interrupted run; another recipe goes out at ${time} so the day keeps its posts.`, code: 'refilled', params: { title: row.title.slice(0, 120), time } });
          }
          const failed = await (overrides.autopilot ?? autopilot.prismaAutopilotPorts).failedPublications(source.id, new Date(now.getTime() - 6 * 3_600_000));
          const at = new Date(now.getTime() + (settings.minLeadMinutes + 2) * 60_000);
          for (const row of failed) {
            await ports.store.settle(source.workspaceId, row.id, { state: 'failed', reason: 'publish_failed', skipped: [...row.skipped, row.wpPostId] });
            (makeup ??= new Map()).set(slotKey(row.targetId, row.slotAt), at);
            entries.push({ at: now.toISOString(), kind: 'healing', channelId: row.targetId, text: `« ${row.title.slice(0, 120)} » failed to publish; another recipe replaces it.`, code: 'publishFailed', params: { title: row.title.slice(0, 120) } });
          }
        }
      } catch { /* the autopilot never stops planning */ }
      const outcome = await planSource({ settings, ports, db, budget, now, ...(makeup ? { makeup } : {}) }, source, auth);
      // Queued posts with a strong title and a weak photo get a new photo too (2026-11-19, ./wordpress-photos.ts).
      if (!overrides.autopilot && ports.generatePhotos && await ports.writer.available(source.workspaceId).catch(() => false)) {
        try {
          const photos = await import('./wordpress-photos');
          const { readPageMemories } = await import('./wordpress-memory');
          const model = memoryModel(await readPageMemories(source.id));
          const upgraded = await photos.upgradeQueuedPhotos({ userId: auth.actor.userId, workspaceId: source.workspaceId }, source.id, settings.image, ports.image, now, targetId => model.generatedPhotosOk(targetId),
            (targetId, traits, appeal) => photoWeak(model.photoValue(targetId, traits), appeal));
          (outcome.generated ??= []).push(...upgraded);
        } catch (error) { outcome.photoProblem = String(error instanceof Error ? error.message : error).slice(0, 200); }
      }
      // Channels switched to title-only captions: their queued posts follow (2026-11-21, ./wordpress-retitle.ts).
      if (!overrides.autopilot) {
        try {
          const titled = Object.entries(configOf(settings, source).channels ?? {}).filter(([, own]) => own?.captionTitle).map(([id]) => id);
          const { retitleQueued } = await import('./wordpress-retitle');
          const count = await retitleQueued({ userId: auth.actor.userId, workspaceId: source.workspaceId }, source.id, titled, now);
          if (count) entries.push({ at: now.toISOString(), kind: 'healing', code: 'retitled', params: { count }, text: `${count} queued posts now carry the recipe title only.` });
          // Channels set to a plain first comment: their queued posts take it too (2026-11-23).
          const config = configOf(settings, source);
          const plain = new Map(Object.keys(config.channels ?? {}).filter(id => config.channels?.[id]?.plainComment).map(id => [id, channelConfig(config, id).firstCommentTemplate]));
          const { recommentQueued } = await import('./wordpress-retitle');
          const recommented = await recommentQueued({ userId: auth.actor.userId, workspaceId: source.workspaceId }, source.id, plain, { max: settings.commentMax, mark: settings.truncationMark }, now);
          if (recommented) entries.push({ at: now.toISOString(), kind: 'healing', code: 'recommented', params: { count: recommented }, text: `${recommented} queued posts now carry their Page's plain first comment.` });
        } catch { /* never stops planning */ }
      }
      // A recipe the owner posted by hand after it was queued is replaced (2026-11-22, ./wordpress-repeats.ts).
      if (!overrides.autopilot) {
        try {
          const { replaceOutsideRepeats } = await import('./wordpress-repeats');
          for (const repeat of await replaceOutsideRepeats(auth.actor, source.id, now))
            entries.push({ at: now.toISOString(), kind: 'healing', channelId: repeat.targetId, code: 'repeatReplaced', params: { title: repeat.title }, text: `« ${repeat.title} » was already posted by hand: another recipe takes its time.` });
        } catch { /* never stops planning */ }
      }
      // Facebook's own scheduler for every queued post (2026-11-24): a hand-off that fails is silent, and the app then
      // publishes the post itself at its time. Posts of 20–23 Nov went out that way, and app-published posts reach less
      // than Facebook-scheduled ones. Each run hands any such post over again; held ones are skipped.
      if (!overrides.autopilot) {
        try {
          const { handOffRemoteSchedules } = await import('@/modules/publishing/server/remote-handoff');
          const { handedOver } = await handOffRemoteSchedules(source.workspaceId, now);
          if (handedOver) entries.push({ at: now.toISOString(), kind: 'healing', code: 'reheld', params: { count: handedOver }, text: `${handedOver} queued posts handed back to Facebook's scheduler.` });
        } catch { /* never stops planning */ }
      }
      // « AI info » on published recipe posts (2026-11-19, ./wordpress-ai-disclosure.ts), when photos are labelled as AI-made.
      if (!overrides.autopilot && settings.image.aiLabel) {
        try {
          const { discloseAiPosts } = await import('./wordpress-ai-disclosure');
          // Pages in the owner's reach test (2026-11-24) get no « AI info » edit.
          const unlabelled = Object.entries(configOf(settings, source).channels ?? {}).filter(([, own]) => own?.noAiLabel).map(([id]) => id);
          const tagged = await discloseAiPosts(source.workspaceId, source.id, now, 60, unlabelled);
          if (tagged.done) entries.push({ at: now.toISOString(), kind: 'healing', code: 'aiTagged', params: { count: tagged.done }, text: `${tagged.done} posts marked as AI-generated.` });
          if (tagged.problem && !(pilot.log ?? []).some(entry => entry.code === 'aiTagFailed' && now.getTime() - Date.parse(entry.at) < 86_400_000))
            entries.push({ at: now.toISOString(), kind: 'healing', code: 'aiTagFailed', params: { why: tagged.problem }, text: 'Facebook did not accept the AI-generated mark.' });
        } catch { /* never stops planning */ }
      }
      for (const made of outcome.generated ?? []) entries.push({ at: now.toISOString(), kind: 'supply', channelId: made.targetId, code: 'photoMade', params: { title: made.title, appeal: made.appeal ?? 0 }, text: `New photo generated for « ${made.title} ».` });
      if (outcome.photoProblem && !(pilot.log ?? []).some(entry => entry.code === 'photoNotMade' && now.getTime() - Date.parse(entry.at) < 86_400_000))
        entries.push({ at: now.toISOString(), kind: 'healing', code: 'photoNotMade', params: { why: outcome.photoProblem }, text: 'A new photo could not be generated.' });
      // Photos of published recipes are read for learning (2026-11-18): newest first, a batch per run, within the AI limit.
      if (!overrides.autopilot && pilot.score.enabled && await ports.writer.available(source.workspaceId).catch(() => false)) {
        try {
          const { photosToLearn } = await import('./wordpress-memory');
          // The photo as it was posted, from the app's own library (2026-11-18): no need to read the recipe site again.
          const found = await photosToLearn(source.id, now, PHOTO_BATCH);
          const ids = found;
          const read = found.length ? Number(await (ports.scoring ?? prismaScoringPorts).ratePhotos(auth.actor, source, found)) || 0 : 0;
          const { lastPhotoProblem } = await import('./wordpress-scoring');
          // A batch that read nothing says why in the activity log, once a day at most (2026-11-18).
          if (ids.length && !read && !(pilot.log ?? []).some(entry => entry.code === 'photosUnread' && now.getTime() - Date.parse(entry.at) < 86_400_000))
            entries.push({ at: now.toISOString(), kind: 'healing', code: 'photosUnread', params: { tried: ids.length, found: found.length, why: (lastPhotoProblem ?? 'no answer').slice(0, 200) }, text: 'Photos could not be read.' });
        } catch (error) {
          entries.push({ at: now.toISOString(), kind: 'healing', code: 'photosUnread', params: { tried: 0, found: 0, why: String(error instanceof Error ? error.message : error).slice(0, 200) }, text: 'Photos could not be read.' });
        }
      }
      if (pilot.healing.pauseBroken) for (const name of outcome.excludedNames ?? []) {
        const recent = (pilot.log ?? []).some(entry => entry.kind === 'healing' && entry.channelName === name && now.getTime() - Date.parse(entry.at) < 86_400_000);
        if (!recent) entries.push({ at: now.toISOString(), kind: 'healing', channelName: name.slice(0, 200), text: 'This channel cannot publish right now (its connection or permissions). Its recipes are on hold; the other channels carry on.', code: 'channelHeld' });
      }
      // Viral radar and breathing room for hot posts (2026-11-16).
      let handled: string[] = [];
      if (pilot.radar.enabled || pilot.breathe.enabled) {
        try {
          const { runRadar, prismaRadarPorts } = await import('./wordpress-radar');
          const radarPorts = overrides.radar ?? prismaRadarPorts(async (planId, wpPostId) => {
            const { changeRecipeSlotNow } = await import('./wordpress');
            const { replaceRecipeSlotConfirmation } = await import('../wordpress/recipe');
            await changeRecipeSlotNow(auth.actor, { planId, confirmation: replaceRecipeSlotConfirmation(planId), action: 'choose', wpPostId });
            return true;
          });
          const channels = await ports.store.pages(source, settings.targetTypes, settings.maxTargets);
          const radarView = await supplyLedgerView(settings, ports, source, now);
          // A hit may go back to a channel that had it longer ago than the winners' cooldown (2026-11-16): after weeks
          // of planning every channel had nearly every recipe, so « ever posted » blocked every spread.
          const radarPilot = autopilotOf(configOf(settings, source).autopilot);
          const recentOn = (targetId: string, wpPostId: string) => [...radarView.byKey.values()].some(row => row.targetId === targetId && row.wpPostId === wpPostId && row.state !== 'failed'
            && row.slotAt.getTime() > now.getTime() - radarPilot.evergreen.cooldownDays * 86_400_000);
          const keep = await import('./wordpress-memory').then(m => m.provenHitRecipes(source.id, now)).catch(() => new Set<string>());
          const radar = await runRadar({ keep, timeZone: configOf(settings, source).timezone, pilot: autopilotOf(configOf(settings, source).autopilot), sourceId: source.id, workspaceId: source.workspaceId, actor: auth.actor, now, handled: new Set(pilot.radarHandled ?? []),
            names: new Map(channels.map(page => [page.id, page.name])), blocked: recentOn }, radarPorts);
          entries.push(...radar.entries); handled = radar.handled;
        } catch (error) {
          // The radar never stops planning, but a failure is said once every six hours instead of passing silently (2026-11-17).
          const last = pilot.log?.find(entry => entry.code === 'radarFailed');
          if (!last || now.getTime() - Date.parse(last.at) >= 6 * 3_600_000) {
            const reason = error instanceof Error ? error.message.slice(0, 160) : 'unknown error';
            entries.push({ at: now.toISOString(), kind: 'radar', text: `The viral radar could not run: ${reason}. Planning carried on.`, code: 'radarFailed', params: { reason } });
          }
        }
      }
      await autopilot.logAutopilot(settings, source, entries, overrides.autopilot, handled).catch(() => undefined);
      // Evening « plan ready » and the weekly report (2026-11-16); sent once each.
      if (!overrides.autopilot) await import('./wordpress-cockpit').then(cockpit => cockpit.notifyAutopilot(settings, source, now)).catch(() => undefined);
      // Once a day from 17:00, tomorrow and the day after are checked again with the latest Page memories, before the
      // evening review (2026-11-18). It runs after this run; each replacement is written in the activity log.
      if (!overrides.autopilot && pilot.score.enabled) void import('./wordpress-cockpit').then(cockpit => cockpit.dailyReplan(auth.actor, configOf(settings, source).timezone, now)).catch(() => undefined);
      // Reply drafts for new comments on recipe posts (2026-11-16): stored for the Inbox, never sent.
      if (!overrides.autopilot && pilot.replies.enabled && await ports.writer.available(source.workspaceId).catch(() => false)) await import('./wordpress-replies').then(replies => replies.draftRecipeReplies({ sourceId: source.id, actor: auth.actor, pilot, now })).catch(() => undefined);
      totals(summary, outcome);
      await ports.store.recordRun(source.workspaceId, source.id, { at: now, error: outcome.reason === 'caption_field_missing' ? captionFieldMessage(outcome.scanned, configOf(settings, source).mapping.captionMetaKey, sourceCredential(source)) : outcome.reason === 'needs_ai' ? NEEDS_AI_MESSAGE : outcome.reason && !['complete', 'budget'].includes(outcome.reason) ? `Planning stopped: ${outcome.reason}` : null, summary: recipeSummaryRecord(outcome, now) });
    } catch {
      totals(summary, { sourceId: source.id, planned: 0, failed: 1, uncertain: 0, unfilled: 0, slots: 0, pages: 0, excludedPages: 0, scanned: 0, reason: 'error' });
      await ports.store.recordRun(source.workspaceId, source.id, { at: now, error: 'Planning could not be completed.', summary: { at: now.toISOString(), reason: 'error' } }).catch(() => undefined);
    } finally {
      await db.close();
    }
  }
  return summary;
}
