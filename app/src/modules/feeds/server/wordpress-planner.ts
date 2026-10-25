import { OperationError } from '@/lib/operation-error';
import { prisma } from '@/server/data';
import { runtimeSecret } from '@/server/config/store';
import { defaultFetchDeps, type FetchDeps } from '@/modules/publishing/server/media/network/net-guard';
import { allocateRecipes, recipeTitleKey, buildImageUrl, buildPermalink, parseRecipe, renderComment, resolveConfig, slotInstants, type PlanConfig, type Recipe, type SlotNeed } from '../wordpress/recipe';
import { openWordpressDb, type DbSettings, type WpDb } from '../wordpress/db';
import { defaultImagePorts, prepareRecipeImage, RecipeImageError, type ImagePorts } from '../wordpress/image';
import { qualifyingOwner, type FeedActor, type FeedAuthorization } from './access';
import { loadWordpressSettings, patchLimits, type WordpressSettings } from './wordpress-settings';
import { prismaRecipeStore, type LedgerRow, type RecipeStore, type SourceRow } from './wordpress-store';

const DATABASE_SECRET = 'feeds.wordpress.databaseUrl';
const MS_DAY = 86_400_000;

export type PlannerPorts = {
  databaseUrl(): Promise<string | null>;
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
  now(): Date;
};
export type PlannedPostInput = { message: string; firstComment: string; targetIds: string[]; scheduledAt: Date; media: Array<{ kind: 'image'; url: string; altText: string }>; firstCommentDelayMinutes: number };

export function defaultPlannerPorts(net: FetchDeps = defaultFetchDeps()): PlannerPorts {
  return {
    databaseUrl: () => runtimeSecret(DATABASE_SECRET),
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
    now: () => new Date(),
  };
}

/* ----- candidates ----- */

export type Candidate = { wpPostId: string; title: string; slug: string; caption: string; imageUrl: string; permalink: string; recipe: Recipe; publishedAt: Date | null };
/** Why scanned posts were not candidates; shown with an empty run so the cause is visible. */
export type ScanRejections = { shared: number; caption: number; image: number; link: number; recipe: number };
export type Scan = { candidates: Candidate[]; scanned: number; exhausted: boolean; rejected: ScanRejections };

/**
 * Read recipes from WordPress newest (or oldest) first until `enough` says the candidates found so far suffice
 * or the scan limit is reached. Rows without a usable caption, image file, link or recipe are not candidates.
 */
export async function scanCandidates(db: WpDb, settings: WordpressSettings, source: Pick<SourceRow, 'siteUrl'>, config: PlanConfig, now: Date, enough: (candidates: Candidate[]) => boolean): Promise<Scan> {
  const candidates: Candidate[] = [];
  let scanned = 0; let exhausted = false;
  const rejected: ScanRejections = { shared: 0, caption: 0, image: 0, link: 0, recipe: 0 };
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
      const permalink = buildPermalink(settings.permalinkTemplate, source.siteUrl, row.slug);
      const recipe = parseRecipe(row.recipe, row.title, settings.minutesSuffix);
      if (!row.caption) { rejected.caption++; continue; }
      if (!imageUrl) { rejected.image++; continue; }
      if (!permalink) { rejected.link++; continue; }
      if (!recipe) { rejected.recipe++; continue; }
      candidates.push({ wpPostId: row.id, title: (recipe.title || row.title).slice(0, settings.titleMax), slug: row.slug, caption: row.caption, imageUrl, permalink, recipe, publishedAt: row.publishedAt });
    }
    if (enough(candidates)) break;
    if (fetched < requested) { exhausted = true; break; }
  }
  return { candidates, scanned, exhausted, rejected };
}

export const commentFor = (settings: WordpressSettings, config: PlanConfig, c: Pick<Candidate, 'recipe' | 'permalink'>) =>
  renderComment(config.firstCommentTemplate, c.recipe, c.permalink, { max: settings.commentMax, mark: settings.truncationMark });

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

  const scan = await scanCandidates(ctx.db, settings, source, config, now, found => !settings.reuse.enabled && allocateRecipes({ needs: todo, candidates: found, blocked: view.blocked, taken: view.taken, reused: view.reused, distinct: config.distinctAcrossPages }).unfilled === 0);
  out.scanned = scan.scanned; out.candidates = scan.candidates.length; out.rejected = scan.rejected;
  const { assignments, unfilled } = allocateRecipes({ needs: todo, candidates: scan.candidates, allowReuse: scan.exhausted, blocked: view.blocked, taken: view.taken, reused: view.reused, distinct: config.distinctAcrossPages });
  out.unfilled = unfilled + (needs.length - todo.length);

  for (const { targetId, slotAt, candidate: c } of assignments) {
    if (ctx.budget.left <= 0) break;
    const previous = reviving.get(slotKey(targetId, slotAt));
    const priorSkipped = previous?.skipped ?? [];
    const claimId = await ports.store.claim({ workspaceId: source.workspaceId, sourceId: source.id, targetId, wpPostId: c.wpPostId, slotAt, title: c.title, permalink: c.permalink, skipped: priorSkipped });
    if (!claimId) continue;
    ctx.budget.left -= 1;
    let postId: string;
    try {
      const image = await prepareRecipeImage(ports.image, { actor: { userId: auth.actor.userId, workspaceId: source.workspaceId }, url: c.imageUrl, fileName: safeName(c.slug), settings: settings.image });
      const post = await ports.createPost(auth.actor, {
        message: c.caption, firstComment: commentFor(settings, config, c), targetIds: [targetId], scheduledAt: slotAt,
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

export async function openDatabase(ports: PlannerPorts, settings: WordpressSettings, siteUrlOverride?: string): Promise<WpDb | null> {
  const siteUrl = (siteUrlOverride || settings.siteUrl || '').trim();
  if (!siteUrl) return null;
  const apiToken = await ports.databaseUrl().catch(() => null);
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
    const db = await openDatabase(ports, settings, source.siteUrl);
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
      await ports.store.recordRun(source.workspaceId, source.id, { at: now, error: outcome.reason && !['complete', 'budget'].includes(outcome.reason) ? `Planning stopped: ${outcome.reason}` : null, summary: recipeSummaryRecord(outcome, now) });
    } catch {
      totals(summary, { sourceId: source.id, planned: 0, failed: 1, uncertain: 0, unfilled: 0, slots: 0, pages: 0, excludedPages: 0, scanned: 0, reason: 'error' });
      await ports.store.recordRun(source.workspaceId, source.id, { at: now, error: 'Planning could not be completed.', summary: { at: now.toISOString(), reason: 'error' } }).catch(() => undefined);
    } finally {
      await db.close();
    }
  }
  return summary;
}
