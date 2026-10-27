import { OperationError } from '@/lib/operation-error';
import { prisma } from '@/server/data';
import { decryptSecret } from '@/server/secret-crypto';
import { defaultFetchDeps, type FetchDeps } from '@/modules/publishing/server/media/network/net-guard';
import type { ArticleInput, ArticleWriting } from '@/modules/studio/ai';
import { allocateRecipes, recipeTitleKey, buildImageUrl, buildPermalink, reportedPermalink, parseRecipe, renderComment, resolveConfig, slotInstants, type PlanConfig, type Recipe, type SlotNeed } from '../wordpress/recipe';
import { openWordpressDb, type DbSettings, type WpDb } from '../wordpress/db';
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
};
export type PlannedPostInput = { message: string; firstComment: string; targetIds: string[]; scheduledAt: Date; media: Array<{ kind: 'image'; url: string; altText: string }>; firstCommentDelayMinutes: number };

export function defaultPlannerPorts(net: FetchDeps = defaultFetchDeps()): PlannerPorts {
  return {
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
    const files = await db.attachments(rows.map(r => r.imageId), config.mapping.attachedFileMetaKey);
    for (const row of rows) {
      // New posts published during a scan shift offsets; never list one recipe twice.
      if (candidates.some(candidate => candidate.wpPostId === row.id)) continue;
      const file = files.get(row.imageId);
      const imageUrl = file ? buildImageUrl(source.siteUrl, settings.uploadsPath, file) : null;
      const permalink = reportedPermalink(source.siteUrl, row.link) ?? buildPermalink(settings.permalinkTemplate, source.siteUrl, row.slug);
      const recipe = parseRecipe(row.recipe, row.title, settings.minutesSuffix);
      const text = writer && row.article ? row.article : '';
      const write = { caption: Boolean(text) && !config.mapping.captionMetaKey, recipe: Boolean(text) && !recipe && !config.mapping.recipeMetaKey };
      if (!row.caption && !write.caption) { rejected.caption++; if (row.captionFieldPresent === false) rejected.captionFieldMissing = (rejected.captionFieldMissing ?? 0) + 1; continue; }
      if (!imageUrl) { rejected.image++; continue; }
      if (!permalink) { rejected.link++; continue; }
      if (!recipe && !write.recipe) { rejected.recipe++; continue; }
      const title = (recipe?.title || row.title).slice(0, settings.titleMax);
      candidates.push({ wpPostId: row.id, title, slug: row.slug, caption: row.caption, imageUrl, permalink, recipe: recipe ?? emptyRecipe(title), publishedAt: row.publishedAt,
        ...(write.caption || write.recipe ? { write: { article: { title: row.title, excerpt: row.excerpt ?? '', text }, ...write } } : {}) });
    }
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
  return view;
}

/* ----- one source ----- */

export type SourceOutcome = { sourceId: string; planned: number; failed: number; uncertain: number; unfilled: number; slots: number; pages: number; excludedPages: number; scanned: number; reason?: string; candidates?: number; rejected?: ScanRejections };
export type Ctx = {
  settings: WordpressSettings; ports: PlannerPorts; db: WpDb; budget: { left: number }; now: Date;
  /** Manual retry: only these slots (see slotKey) are planned, and a failed slot is revived even past its attempt cap. */
  retry?: ReadonlySet<string>;
  /** Wall-clock end (epoch ms) for a run a member waits on; slots left then stay empty for the next run. */
  deadline?: number;
};
const DEFINITIVE = new Set(['invalid_request', 'forbidden', 'unauthorized', 'unavailable', 'conflict', 'not_found']);
const AUTHORITY = new Set(['forbidden', 'unauthorized', 'unavailable']);
const safeName = (slug: string) => `${slug.replace(/[^A-Za-z0-9-]/g, '').slice(0, 80) || 'recipe'}-fb.jpg`;

export const configOf = (settings: WordpressSettings, source: Pick<SourceRow, 'config'>): PlanConfig => resolveConfig(settings.defaults, source.config, patchLimits(settings));

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

  const candidatePages = await ports.store.pages(source, settings.targetTypes, settings.maxTargets);
  const pages: Array<{ id: string; name: string }> = [];
  for (const page of candidatePages) {
    try { await ports.validateTarget(auth.actor, page.id); pages.push(page); } catch { out.excludedPages += 1; }
  }
  out.pages = pages.length;
  const pageOrder = new Map(pages.map((page, index) => [page.id, index]));
  const staggered = (slotAt: Date, targetId: string) => new Date(slotAt.getTime() + (pageOrder.get(targetId) ?? 0) * (Number.isFinite(settings.pageStaggerMinutes) ? settings.pageStaggerMinutes : 0) * 60_000);
  if (!pages.length) return { ...out, reason: 'no_pages' };

  const slots = slotInstants({ now, slots: config.slots, timezone: config.timezone, horizonDays: config.horizonDays, leadMinutes: settings.minLeadMinutes });
  out.slots = slots.length;
  const view = await supplyLedgerView(settings, ports, source, now);

  const needs: SlotNeed[] = []; const reviving = new Map<string, LedgerRow>();
  for (const slotAt of slots) for (const page of pages) {
    const key = slotKey(page.id, slotAt);
    if (ctx.retry && !ctx.retry.has(key)) continue;
    const row = view.byKey.get(key);
    if (row && !(row.state === 'failed' && (ctx.retry !== undefined || row.skipped.length < settings.maxSlotAttempts))) continue;
    needs.push({ targetId: page.id, slotAt, ...(row ? { avoid: new Set(row.skipped) } : {}) });
    if (row) reviving.set(slotKey(page.id, slotAt), row);
  }
  const todo = needs.slice(0, Math.max(0, ctx.budget.left));
  if (!todo.length) return { ...out, reason: needs.length ? 'budget' : 'complete' };

  const writer = await ports.writer.available(source.workspaceId).catch(() => false);
  const scan = await scanCandidates(ctx.db, settings, source, config, now, found => !settings.reuse.enabled && allocateRecipes({ needs: todo, candidates: found, blocked: view.blocked, taken: view.taken, reused: view.reused, distinct: config.distinctAcrossPages }).unfilled === 0, writer);
  out.scanned = scan.scanned; out.candidates = scan.candidates.length; out.rejected = scan.rejected;
  // Every post came back without the caption field itself: credentials or the REST exposure of that field failed, not the content.
  const readable = scan.scanned - scan.rejected.shared;
  if (readable > 0 && scan.rejected.captionFieldMissing === readable) out.reason = 'caption_field_missing';
  else if (readable > 0 && !writer && !config.mapping.recipeMetaKey && scan.rejected.recipe === readable) out.reason = 'needs_ai';
  const { assignments, unfilled } = allocateRecipes({ needs: todo, candidates: scan.candidates, allowReuse: scan.exhausted, blocked: view.blocked, taken: view.taken, reused: view.reused, distinct: config.distinctAcrossPages });
  out.unfilled = unfilled + (needs.length - todo.length);

  for (const [index, { targetId, slotAt, candidate: c }] of assignments.entries()) {
    if (ctx.budget.left <= 0) break;
    if (ctx.deadline !== undefined && Date.now() >= ctx.deadline) { out.unfilled += assignments.length - index; out.reason = 'time_limit'; break; }
    const previous = reviving.get(slotKey(targetId, slotAt));
    const priorSkipped = previous?.skipped ?? [];
    const claimId = await ports.store.claim({ workspaceId: source.workspaceId, sourceId: source.id, targetId, wpPostId: c.wpPostId, slotAt, title: c.title, permalink: c.permalink, skipped: priorSkipped });
    if (!claimId) continue;
    ctx.budget.left -= 1;
    let written: { caption: string; firstComment: string };
    try { written = await writeCandidate(ports, auth.actor, settings, config, c); }
    catch (error) {
      // Nothing was created: the slot fails and is planned again, without this post when it has nothing to write from.
      const code = error instanceof OperationError ? error.code : 'unknown';
      await ports.store.settle(source.workspaceId, claimId, { state: 'failed', reason: `writing:${code}`, skipped: code === 'invalid_request' ? [...priorSkipped, c.wpPostId] : priorSkipped }).catch(() => undefined);
      out.failed += 1;
      if (AUTHORITY.has(code)) return { ...out, reason: code };
      continue;
    }
    let postId: string;
    try {
      const image = await prepareRecipeImage(ports.image, { actor: { userId: auth.actor.userId, workspaceId: source.workspaceId }, url: c.imageUrl, fileName: safeName(c.slug), settings: settings.image });
      const post = await ports.createPost(auth.actor, {
        // The slot keeps its identity (ledger key); only the publish time is offset per Page, so Pages never post in lockstep.
        message: written.caption, firstComment: written.firstComment, targetIds: [targetId], scheduledAt: staggered(slotAt, targetId),
        media: [{ kind: 'image', url: `media:${image.mediaId}`, altText: c.title.slice(0, settings.altMax) }], firstCommentDelayMinutes: config.firstCommentDelayMinutes,
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
    try { await ports.store.settle(source.workspaceId, claimId, { state: 'planned', postId }); out.planned += 1; }
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
export async function runRecipePlanning(overrides: Partial<PlannerPorts> = {}, loaded?: WordpressSettings): Promise<RecipePlanSummary> {
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
      const outcome = await planSource({ settings, ports, db, budget, now }, source, auth);
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
