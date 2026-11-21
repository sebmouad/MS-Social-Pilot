import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { OperationError } from '@/lib/operation-error';
import { withWorkspaceOperation } from '@/server/data-control/guard';
import { prisma } from '@/server/data';
import { checkUrlShape } from '@/modules/publishing/server/media/network/net-guard';
import { encryptSecret } from '@/server/secret-crypto';
import { WORDPRESS_BOUNDS } from '../wordpress/config';
import { pauseAndCancelRecipeSourceConfirmation, pauseRecipeSourceConfirmation, planConfigPatchSchema, resumeRecipeSourceConfirmation, retryRecipeSlotsConfirmation, replaceRecipeSlotConfirmation, runRecipePlannerConfirmation, saveRecipeSourceConfirmation, type PlanConfig } from '../wordpress/recipe';
import { authorizeFeedWrite, authorizeFeeds, type FeedActor, type FeedAuthorization } from './access';
import { audit, bad, lockActor, protect, type Tx } from './core';
import { feedsError } from './messages';
import { commentFor, configOf, writeCandidate, defaultPlannerPorts, openDatabase, planSource, recipeSummaryRecord, scanCandidates, supplyLedgerView, type PlannerPorts } from './wordpress-planner';
import { loadWordpressSettings, patchLimits, type WordpressSettings } from './wordpress-settings';
import { computePoolHealth, forgetPoolHealth, poolHealthWithin, type PoolHealth } from './wordpress-pool';
import { cancelPlannedPosts, changeRecipeSlot, retryRecipeSlots, type SlotAction } from './wordpress-recovery';
import { AUTOPILOT_LEARNED_KEYS, autopilotOf } from '../wordpress/autopilot';
import { ctaFor, withCta } from '../wordpress/caption';
import { countPlans, selectPlans, selectSource, type LedgerRow, type SourceRow } from './wordpress-store';

/**
 * Customer service of the WordPress recipe source: one source per workspace. UI, HTTP and MCP all call these
 * functions; authorization, channel scope, exact confirmations and audit live here.
 */
const ID = /^[A-Za-z0-9_-]{1,256}$/;
export type RecipeDeps = Partial<PlannerPorts>;

const readSchema = (pageMax: number) => z.object({ page: z.number().int().min(1).max(pageMax).optional() }).strict();
const saveSchema = (s: WordpressSettings) => z.object({
  name: z.string().trim().min(1).max(s.sourceNameMax), siteUrl: z.string().trim().max(2048), enabled: z.boolean().optional(),
  allTargets: z.boolean(), targetIds: z.array(z.string().regex(ID).max(s.identifierMax)).max(s.maxTargets),
  config: planConfigPatchSchema(patchLimits(s)).optional(), confirmation: z.string(),
  /** Omitted keeps the saved credential; an empty string removes it. */
  credential: z.string().trim().max(2048).optional(),
}).strict();
const stateSchema = z.object({ enabled: z.boolean(), cancelScheduled: z.boolean().optional(), confirmation: z.string() }).strict();
const confirmSchema = z.object({ confirmation: z.string() }).strict();

const parse = async <S extends z.ZodTypeAny>(schema: S, input: unknown): Promise<z.output<S>> => { const r = schema.safeParse(input ?? {}); if (!r.success) throw await bad(); return r.data; };
const scoped = (auth: FeedAuthorization) => auth.actor.allowedTargetIds !== undefined;
/** A channel-limited member sees and manages only a source whose channels are all inside their access. */
const visible = (auth: FeedAuthorization, source: SourceRow) => !scoped(auth) || (!source.allTargets && source.targetIds.length > 0 && source.targetIds.every(id => auth.actor.allowedTargetIds!.includes(id)));
const unavailable = () => feedsError('unavailable', 'Recipe planning is temporarily unavailable. Refresh and try again.');
const notFound = () => feedsError('not_found', 'No recipe source is set up in this workspace.');

async function transact<T>(workspaceId: string, s: WordpressSettings, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withWorkspaceOperation(workspaceId, () => prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${workspaceId}))::text`;
    return fn(tx);
  }, { timeout: s.transaction.timeoutMs, maxWait: s.transaction.maxWaitMs }));
}

export type SourceView = {
  id: string; name: string; siteUrl: string; hasCredential: boolean; enabled: boolean; allTargets: boolean; targetIds: string[]; config: PlanConfig;
  lastRunAt: string | null; lastError: string | null; lastSummary: unknown;
};
const viewOf = (s: WordpressSettings, row: SourceRow): SourceView => ({
  id: row.id, name: row.name, siteUrl: row.siteUrl, hasCredential: Boolean(row.apiCredential), enabled: row.enabled, allTargets: row.allTargets, targetIds: row.targetIds, config: configOf(s, row),
  lastRunAt: row.lastRunAt?.toISOString() ?? null, lastError: row.lastError, lastSummary: row.lastSummary,
});
export type PlanView = { id: string; targetId: string; targetName: string; wpPostId: string; slotAt: string; state: LedgerRow['state']; postId: string | null; title: string; permalink: string | null; reason: string | null; score: number | null; kind: string | null };
const planView = (row: LedgerRow): PlanView => ({ id: row.id, targetId: row.targetId, targetName: row.targetName ?? '', wpPostId: row.wpPostId, slotAt: row.slotAt.toISOString(), state: row.state, postId: row.postId, title: row.title, permalink: row.permalink, reason: row.reason, score: row.score ?? null, kind: row.kind ?? null });

async function selectablePages(workspaceId: string, s: WordpressSettings, auth: FeedAuthorization) {
  const rows = await prisma.$queryRaw<Array<{ id: string; name: string }>>`SELECT id, name FROM targets WHERE "workspaceId" = ${workspaceId} AND enabled = true AND "canPublish" = true AND type::text = ANY(${s.targetTypes}::text[]) ORDER BY name ASC, id ASC LIMIT ${s.maxTargets}`;
  const allowed = auth.actor.allowedTargetIds;
  return allowed === undefined ? rows : rows.filter(r => allowed.includes(r.id));
}

/* ----- read ----- */

/** Pool health for the source's channels the viewer may see; null when the library cannot be read right now. */
/** How long a screen waits for a first library scan before showing the page without its figures. */
/**
 * A saved form never changes what the autopilot learned (2026-11-16), and never drops it either (2026-11-21: a save
 * without an autopilot block erased the learned times, the radar's handled hits and the log).
 */
export function keepLearned(storedConfig: unknown, config: Record<string, unknown>): void {
  const stored = storedConfig && typeof storedConfig === 'object' ? (storedConfig as { autopilot?: Record<string, unknown> }).autopilot : undefined;
  if (!stored || typeof stored !== 'object') return;
  const mine = (config.autopilot && typeof config.autopilot === 'object' ? config.autopilot : (config.autopilot = {})) as Record<string, unknown>;
  for (const key of AUTOPILOT_LEARNED_KEYS) { if (stored[key] !== undefined) mine[key] = stored[key]; else delete mine[key]; }
}

/** How long the Feeds page waits for a first recipe count before showing « Still counting » (was 2.5 s). */
const POOL_WAIT_MS = 800;

async function readPool(s: WordpressSettings, source: SourceRow, ports: PlannerPorts, auth: FeedAuthorization): Promise<PoolHealth | null> {
  try {
    const now = ports.now();
    const health = await poolHealthWithin(`${source.id}|${JSON.stringify([source.workspaceId, source.config, source.targetIds, source.allTargets, s, auth.actor])}`, s.poolCacheSeconds, now, async () => {
      const db = await openDatabase(ports, s, source);
      if (!db) throw new Error('library_unavailable');
      try { return await computePoolHealth({ settings: s, ports, db, source, now }); } finally { await db.close(); }
    }, POOL_WAIT_MS);
    if (!health) return null;
    const allowed = auth.actor.allowedTargetIds;
    if (allowed === undefined) return health;
    const pages = health.pages.filter(p => allowed.includes(p.targetId));
    return { ...health, pages, low: pages.some(p => p.low) };
  } catch { return null; }
}

export async function readRecipeSource(actor: FeedActor, input: unknown = {}, deps: RecipeDeps = {}) {
  const s = await loadWordpressSettings();
  const query = await parse(readSchema(s.pageNumberMax), input);
  const auth = await authorizeFeeds(actor, 'read');
  return protect((async () => {
    const row = await selectSource(actor.workspaceId);
    const source = row && visible(auth, row) ? row : null;
    const page = query.page ?? 1;
    const ports = { ...defaultPlannerPorts(), ...deps };
    const configured = Boolean(source?.siteUrl || s.siteUrl);
    const poolReady = Boolean(source) && s.enabled && configured;
    const [pages, plans, counts, pool] = await Promise.all([
      selectablePages(actor.workspaceId, s, auth),
      source ? selectPlans(actor.workspaceId, source.id, (page - 1) * s.ledgerPageSize, s.ledgerPageSize + 1) : Promise.resolve([] as LedgerRow[]),
      source ? countPlans(actor.workspaceId, source.id) : Promise.resolve({} as Record<string, number>),
      poolReady && source ? readPool(s, source, ports, auth) : Promise.resolve(null),
    ]);
    const allowed = auth.actor.allowedTargetIds;
    const shown = (allowed === undefined ? plans : plans.filter(p => allowed.includes(p.targetId)));
    return {
      source: source ? viewOf(s, source) : null, defaults: { ...s.defaults, siteUrl: s.siteUrl } as PlanConfig & { siteUrl: string }, pages,
      plans: { items: shown.slice(0, s.ledgerPageSize).map(planView), page, pageSize: s.ledgerPageSize, hasMore: plans.length > s.ledgerPageSize }, counts,
      pool, reuse: { enabled: s.reuse.enabled, cooldownDays: Math.max(s.reuse.cooldownDays, source ? configOf(s, source).cooldownDays : s.defaults.cooldownDays) }, available: s.enabled && configured, scopedView: scoped(auth),
      limits: { maxNameCharacters: s.sourceNameMax, maxTemplateCharacters: s.textMax, maxTargets: s.maxTargets, horizonDays: WORDPRESS_BOUNDS.horizonDays, cooldownDays: WORDPRESS_BOUNDS.repostCooldownDays, ageDays: WORDPRESS_BOUNDS.maxAgeDays, delayMinutes: WORDPRESS_BOUNDS.firstCommentDelayMinutes, commentMaxCharacters: s.commentMax, pauseCancel: s.pauseCancel.enabled },
    };
  })());
}

/* ----- save / pause / resume ----- */

export async function saveRecipeSource(actor: FeedActor, input: unknown, deps: RecipeDeps = {}) {
  const s = await loadWordpressSettings();
  const data = await parse(saveSchema(s), input);
  if (data.confirmation !== saveRecipeSourceConfirmation(data.name)) throw await bad();
  const auth = await authorizeFeedWrite(actor);
  if (scoped(auth) && (data.allTargets || !data.targetIds.length)) throw await bad('Choose at least one channel for this recipe source.');
  if (!data.allTargets && (!data.targetIds.length || new Set(data.targetIds).size !== data.targetIds.length)) throw await bad('Choose at least one channel, or use all channels.');
  const siteUrl = (data.siteUrl || s.siteUrl);
  let normalized: string;
  try {
    const url = checkUrlShape(siteUrl, { allowHttp: s.image.fetch.allowHttp, hostAllowlist: s.image.fetch.hostAllowlist });
    if (url.protocol !== 'https:' || url.search || url.hash) throw new Error('shape');
    normalized = `${url.origin}${url.pathname}`.replace(/\/+$/, '');
  } catch (error) { throw error instanceof OperationError ? error : await bad('Enter the recipe site address, starting with https://'); }
  const ports = { ...defaultPlannerPorts(), ...deps };
  const known = new Set((await selectablePages(actor.workspaceId, s, auth)).map(p => p.id));
  if (!data.allTargets) {
    if (data.targetIds.some(id => !known.has(id))) throw await feedsError('unavailable', 'One or more channels are unavailable. Refresh and choose again.');
    for (const id of data.targetIds) await ports.validateTarget(auth.actor, id);
  }
  const targetIds = data.allTargets ? [] : data.targetIds;
  if (data.credential && (/^[a-z][a-z0-9+.-]*:\/\//i.test(data.credential) || !/^(Bearer\s+\S+|[^:\s][^:]*:.+)$/i.test(data.credential))) throw await bad('Enter the WordPress credential as username:application-password.');
  const credential = data.credential === undefined ? undefined : data.credential ? encryptSecret(data.credential) : null;
  const config = data.config ?? {};
  return protect(transact(actor.workspaceId, s, async tx => {
    await lockActor(tx, actor, true);
    const rows = await tx.$queryRaw<Array<{ id: string; enabled: boolean; config: unknown }>>`SELECT id, enabled, config FROM wordpress_recipe_sources WHERE "workspaceId" = ${actor.workspaceId} FOR UPDATE`;
    const existing = rows[0];
    // What the autopilot learned and logged is written by the planner, never by a settings form (2026-11-16).
    keepLearned(existing?.config, config);
    const enabled = data.enabled ?? existing?.enabled ?? false;
    const id = existing?.id ?? `wrs_${randomUUID()}`;
    if (existing) {
      await tx.$executeRaw`UPDATE wordpress_recipe_sources SET name = ${data.name}, "siteUrl" = ${normalized}, enabled = ${enabled}, "allTargets" = ${data.allTargets}, "targetIds" = ${JSON.stringify(targetIds)}::jsonb, config = ${JSON.stringify(config)}::jsonb, "apiCredential" = CASE WHEN ${credential === undefined} THEN "apiCredential" ELSE ${credential ?? null} END, "lastError" = NULL, "updatedAt" = NOW() WHERE id = ${id} AND "workspaceId" = ${actor.workspaceId}`;
    } else {
      await tx.$executeRaw`INSERT INTO wordpress_recipe_sources (id, "workspaceId", name, "siteUrl", "apiCredential", enabled, "allTargets", "targetIds", config, "createdAt", "updatedAt") VALUES (${id}, ${actor.workspaceId}, ${data.name}, ${normalized}, ${credential ?? null}, ${enabled}, ${data.allTargets}, ${JSON.stringify(targetIds)}::jsonb, ${JSON.stringify(config)}::jsonb, NOW(), NOW())`;
    }
    forgetPoolHealth(id);
    await audit(tx, actor.workspaceId, actor, existing ? 'feeds.recipe_source_updated' : 'feeds.recipe_source_created', { sourceId: id, host: new URL(normalized).hostname, allTargets: data.allTargets, targetCount: targetIds.length, enabled, ...(credential === undefined ? {} : { credential: credential ? 'saved' : 'removed' }) });
    await lockActor(tx, actor, true);
    const saved = await tx.$queryRawUnsafe<Array<Record<string, unknown>>>(`SELECT id FROM wordpress_recipe_sources WHERE id = $1 AND "workspaceId" = $2`, id, actor.workspaceId);
    if (!saved[0]) throw await unavailable();
    return { id, created: !existing };
  })).then(async result => ({ ...result, source: viewOf(s, (await selectSource(actor.workspaceId))!) }));
}

/**
 * Pause or resume automatic planning for the workspace source. Pausing keeps posts already scheduled unless the member
 * also asks (with the matching confirmation, and while Root allows it) to cancel the source's scheduled, unpublished
 * posts; those are cancelled through Publishing after the pause is saved, so a failure never undoes the pause.
 */
export async function setRecipeSourceState(actor: FeedActor, input: unknown, deps: RecipeDeps = {}) {
  const s = await loadWordpressSettings();
  const data = await parse(stateSchema, input);
  const cancel = data.cancelScheduled === true;
  if (cancel && data.enabled) throw await bad();
  if (data.confirmation !== (data.enabled ? resumeRecipeSourceConfirmation : cancel ? pauseAndCancelRecipeSourceConfirmation : pauseRecipeSourceConfirmation)) throw await bad();
  if (cancel && !s.pauseCancel.enabled) throw new OperationError('unavailable', 'Cancelling scheduled posts is not available right now. Pause without cancelling, or cancel the posts in Publishing.');
  const auth = await authorizeFeedWrite(actor);
  const paused = await protect(transact(actor.workspaceId, s, async tx => {
    await lockActor(tx, actor, true);
    const rows = await tx.$queryRaw<Array<{ id: string; allTargets: boolean; targetIds: unknown }>>`SELECT id, "allTargets", "targetIds" FROM wordpress_recipe_sources WHERE "workspaceId" = ${actor.workspaceId} FOR UPDATE`;
    const row = rows[0];
    const ids = Array.isArray(row?.targetIds) ? (row!.targetIds as unknown[]).filter((v): v is string => typeof v === 'string') : [];
    if (!row || (scoped(auth) && (row.allTargets || !ids.every(id => auth.actor.allowedTargetIds!.includes(id))))) throw await notFound();
    await tx.$executeRaw`UPDATE wordpress_recipe_sources SET enabled = ${data.enabled}, "lastError" = NULL, "updatedAt" = NOW() WHERE id = ${row.id} AND "workspaceId" = ${actor.workspaceId}`;
    await audit(tx, actor.workspaceId, actor, data.enabled ? 'feeds.recipe_source_resumed' : 'feeds.recipe_source_paused', { sourceId: row.id, cancelScheduled: cancel });
    await lockActor(tx, actor, true);
    return { id: row.id, enabled: data.enabled };
  }));
  if (!cancel) return paused;
  const ports = { ...defaultPlannerPorts(), ...deps };
  let cancellation: CancelOutcomeView;
  try {
    const source = await selectSource(actor.workspaceId);
    if (!source) throw notFound();
    cancellation = { ...(await cancelPlannedPosts({ settings: s, ports, now: ports.now() }, source, auth)), incomplete: false };
    await audit(prisma as unknown as Tx, actor.workspaceId, actor, 'feeds.recipe_source_posts_cancelled', { sourceId: paused.id, cancelled: cancellation.cancelled, notCancelled: cancellation.notCancelled, remaining: cancellation.remaining }).catch(() => undefined);
  } catch { cancellation = { cancelled: 0, notCancelled: 0, remaining: true, incomplete: true }; }
  return { ...paused, cancellation };
}
type CancelOutcomeView = Awaited<ReturnType<typeof cancelPlannedPosts>> & { incomplete: boolean };

/**
 * Plan again the upcoming slots that failed or whose outcome was uncertain, as the signed-in member. Uncertain slots are
 * checked against Publishing first and are never planned a second time when a post exists; see retryRecipeSlots.
 */
export async function retryRecipeSlotsNow(actor: FeedActor, input: unknown, deps: RecipeDeps = {}) {
  const s = await loadWordpressSettings();
  const data = await parse(confirmSchema, input);
  if (data.confirmation !== retryRecipeSlotsConfirmation) throw await bad();
  const { auth, source } = await authorizedSource(actor);
  if (!s.enabled) throw new OperationError('unavailable', 'Recipe planning is not available right now.');
  if (!source.enabled) throw new OperationError('conflict', 'This recipe source is paused. Resume it to plan posts.');
  const ports = { ...defaultPlannerPorts(), ...deps };
  const db = await openDatabase(ports, s, source);
  if (!db) throw new OperationError('unavailable', 'The recipe library could not be reached. Try again later.');
  try {
    const outcome = await retryRecipeSlots({ settings: s, ports, db, now: ports.now() }, source, auth);
    forgetPoolHealth(source.id);
    await audit(prisma as unknown as Tx, actor.workspaceId, actor, 'feeds.recipe_slots_retried', { sourceId: source.id, ...outcome }).catch(() => undefined);
    return { sourceId: source.id, ...outcome };
  } catch (error) {
    if (error instanceof OperationError) throw error;
    throw new OperationError('upstream_failure', 'Planning could not be completed. Check the planned posts before trying again.');
  } finally { await db.close(); }
}

const slotActionSchema = z.object({
  planId: z.string().min(1).max(200), confirmation: z.string(),
  action: z.enum(['replace', 'leave_empty', 'fill', 'choose', 'exclude']).default('replace'),
  wpPostId: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/).optional(),
}).strict().refine(v => (v.action === 'choose') === (v.wpPostId !== undefined), { message: 'Choose a recipe.' });

/**
 * Change one upcoming planned slot, as the signed-in member (2026-11-15): another recipe, a recipe they choose, leave
 * the time empty (and fill it again), or never post its recipe again (saved in the source settings, then replaced).
 * Refused (conflict) when the post can no longer be cancelled: publishing, published or edited by someone.
 */
export async function changeRecipeSlotNow(actor: FeedActor, input: unknown, deps: RecipeDeps = {}) {
  const s = await loadWordpressSettings();
  const data = await parse(slotActionSchema, input);
  if (data.confirmation !== replaceRecipeSlotConfirmation(data.planId)) throw await bad();
  const { auth, source } = await authorizedSource(actor);
  if (!s.enabled) throw new OperationError('unavailable', 'Recipe planning is not available right now.');
  if (!source.enabled) throw new OperationError('conflict', 'This recipe source is paused. Resume it to plan posts.');
  const rows = await protect(prisma.$queryRaw<Array<LedgerRow & { skipped: unknown }>>`SELECT id, "sourceId", "targetId", "wpPostId", "slotAt", state, "postId", title, permalink, reason, skipped, "claimedAt"
    FROM wordpress_recipe_plans WHERE "workspaceId" = ${actor.workspaceId} AND "sourceId" = ${source.id} AND id = ${data.planId}`);
  const raw = rows[0];
  if (!raw) throw await notFound();
  const row: LedgerRow = { ...raw, skipped: Array.isArray(raw.skipped) ? raw.skipped.filter((v): v is string => typeof v === 'string') : [] };
  if (data.action === 'exclude') {
    // Saved first, so the replacement and every later plan already leave this recipe out.
    const config = (source.config && typeof source.config === 'object' ? source.config : {}) as Record<string, unknown>;
    const current = Array.isArray(config.excluded) ? config.excluded.filter((item): item is { id: string; title: string } => Boolean(item) && typeof (item as { id?: unknown }).id === 'string') : [];
    const excluded = [...new Map([...current, { id: row.wpPostId, title: row.title.slice(0, 300) }].map(item => [item.id, item])).values()].slice(-2000);
    await protect(prisma.$executeRaw`UPDATE wordpress_recipe_sources SET config = jsonb_set(COALESCE(config, '{}'::jsonb), '{excluded}', ${JSON.stringify(excluded)}::jsonb), "updatedAt" = NOW() WHERE id = ${source.id} AND "workspaceId" = ${actor.workspaceId}`);
    source.config = { ...config, excluded };
  }
  const action: SlotAction = data.action === 'choose' ? { kind: 'choose', wpPostId: data.wpPostId! } : { kind: data.action };
  const ports = { ...defaultPlannerPorts(), ...deps };
  const db = await openDatabase(ports, s, source);
  if (!db) throw new OperationError('unavailable', 'The recipe library could not be reached. Try again later.');
  try {
    const outcome = await changeRecipeSlot({ settings: s, ports, db, now: ports.now() }, source, auth, row, action,
      async (postId: string) => { const { deletePostDurably } = await import('@/modules/publishing/server/deletion'); await deletePostDurably({ userId: actor.userId, workspaceId: actor.workspaceId, ...(auth.actor.allowedTargetIds === undefined ? {} : { allowedTargetIds: auth.actor.allowedTargetIds }) }, postId, false); },
      async (fields: { skipped?: string[]; reason?: string | null }) => {
        if (fields.skipped) await prisma.$executeRaw`UPDATE wordpress_recipe_plans SET skipped = ${JSON.stringify(fields.skipped)}::jsonb WHERE id = ${row.id} AND "workspaceId" = ${actor.workspaceId}`;
        if (fields.reason !== undefined) await prisma.$executeRaw`UPDATE wordpress_recipe_plans SET reason = ${fields.reason}, "updatedAt" = NOW() WHERE id = ${row.id} AND "workspaceId" = ${actor.workspaceId} AND state = 'failed'`;
      });
    if (!outcome.replaced) throw new OperationError('conflict', 'This time can no longer be changed: its post is publishing, published or was edited. Open it to change it.');
    forgetPoolHealth(source.id);
    await audit(prisma as unknown as Tx, actor.workspaceId, actor, 'feeds.recipe_slot_changed', { sourceId: source.id, planId: row.id, action: data.action, previous: row.wpPostId, ...(data.wpPostId ? { chosen: data.wpPostId } : {}), ...outcome }).catch(() => undefined);
    return { sourceId: source.id, action: data.action, ...outcome };
  } catch (error) {
    if (error instanceof OperationError) throw error;
    throw new OperationError('upstream_failure', 'Planning could not be completed. Check the planned posts before trying again.');
  } finally { await db.close(); }
}

/** Recipes a member can choose for a slot: the next eligible ones in the source's order, without excluded recipes (2026-11-15). */
export async function listRecipeChoices(actor: FeedActor, deps: RecipeDeps = {}) {
  const s = await loadWordpressSettings();
  const { source } = await authorizedSource(actor);
  const ports = { ...defaultPlannerPorts(), ...deps };
  const db = await openDatabase(ports, s, source);
  if (!db) throw new OperationError('unavailable', 'The recipe library could not be reached. Try again later.');
  try {
    const config = configOf(s, source);
    const excluded = new Set((config.excluded ?? []).map(item => item.id));
    const writer = await ports.writer.available(source.workspaceId).catch(() => false);
    const scan = await scanCandidates(db, s, source, config, ports.now(), found => found.filter(c => !excluded.has(c.wpPostId)).length >= RECIPE_CHOICES, writer);
    return { items: scan.candidates.filter(c => !excluded.has(c.wpPostId)).slice(0, RECIPE_CHOICES).map(c => ({ wpPostId: c.wpPostId, title: c.title, permalink: c.permalink, publishedAt: c.publishedAt?.toISOString() ?? null })) };
  } finally { await db.close(); }
}
const RECIPE_CHOICES = 80;

/* ----- preview and run ----- */

async function authorizedSource(actor: FeedActor) {
  const auth = await authorizeFeedWrite(actor);
  const source = await protect(selectSource(actor.workspaceId));
  if (!source || !visible(auth, source)) throw await notFound();
  return { auth, source };
}

/** `writtenByAi`: present when AI writes this post's caption or lists; false when it could not for this preview. */
export type PreviewItem = { wpPostId: string; title: string; permalink: string; imageUrl: string; caption: string; firstComment: string; publishedAt: string | null; writtenByAi?: boolean;
  /** Autopilot (2026-11-16): the recipe's score for tomorrow at the first shared time, its kind, and for the first recipe a channel's caption. */
  score?: number; kind?: string; channelCaption?: { channel: string; text: string } };
/**
 * What the autopilot would do with the previewed recipes (2026-11-16): each one's score and kind (AI rates the ones it
 * has not seen), and the caption it would write for the first channel. Nothing is planned or published.
 */
async function addAutopilotPreview(items: PreviewItem[], c: { ports: PlannerPorts; actor: FeedActor; source: SourceRow; config: ReturnType<typeof configOf>; settings: WordpressSettings; writer: boolean; now: Date }) {
  const pilot = autopilotOf(c.config.autopilot);
  if (!items.length) return;
  const { scoreRecipe, guessKind } = await import('../wordpress/score');
  if (pilot.score.enabled && c.ports.scoring) {
    const ids = items.map(item => item.wpPostId);
    let ratings = await c.ports.scoring.ratings(c.source.id, ids);
    const unrated = items.filter(item => !ratings.get(item.wpPostId)?.kind);
    if (c.writer && unrated.length) { await c.ports.scoring.rate(c.actor, c.source, unrated.map(item => ({ id: item.wpPostId, title: item.title }))).catch(() => undefined); ratings = await c.ports.scoring.ratings(c.source.id, ids); }
    const tomorrow = new Date(c.now.getTime() + 86_400_000);
    const hour = Number((c.config.slots[0] ?? '12:00').slice(0, 2));
    for (const item of items) {
      const rating = ratings.get(item.wpPostId);
      item.score = scoreRecipe({ title: item.title, hook: rating?.hook ?? null, photo: rating?.photo ?? null, kind: rating?.kind ?? null }, { date: tomorrow, weekday: tomorrow.getUTCDay(), hour, leadDays: pilot.moments.leadDays, rules: new Set(pilot.moments.rules) }).score;
      item.kind = rating?.kind ?? guessKind(item.title);
    }
  }
  if (pilot.captions.enabled && c.writer && c.ports.captions) {
    const pages = await c.ports.store.pages(c.source, c.settings.targetTypes, c.settings.maxTargets);
    const first = items[0]!; const page = pages[0];
    if (page) {
      const { captionPrompt, cleanCaption, voiceFor } = await import('../wordpress/caption');
      const { system, prompt } = captionPrompt({ channel: page.name, voice: voiceFor(pilot.captions.voice, 0), style: 'question', question: pilot.captions.question, emoji: pilot.captions.emoji, title: first.title, caption: first.caption, ingredients: [] });
      const text = cleanCaption(await c.ports.captions.write(c.actor, system, prompt).catch(() => ''), c.settings.textMax);
      if (text) first.channelCaption = { channel: page.name, text };
    }
  }
}

/** The next recipes exactly as they will post: image, caption and first comment. Nothing is created. */
export async function previewRecipeSource(actor: FeedActor, input: unknown = {}, deps: RecipeDeps = {}) {
  const s = await loadWordpressSettings();
  await parse(z.object({}).strict(), input);
  const { source } = await authorizedSource(actor);
  const ports = { ...defaultPlannerPorts(), ...deps };
  const db = await openDatabase(ports, s, source);
  if (!db) throw await feedsError('unavailable', 'The recipe library could not be reached. Try again later.');
  try {
    const config = configOf(s, source);
    const now = ports.now();
    const view = await supplyLedgerView(s, ports, source, now);
    const used = new Set([...view.blocked.values()].flatMap(ids => [...ids]));
    const dates = new Map<string, number>();
    for (const page of view.reused.values()) for (const [id, at] of page) dates.set(id, Math.max(dates.get(id) ?? -Infinity, at));
    const fresh = <C extends { wpPostId: string }>(found: C[], allowReuse = true): C[] => found.filter(c => !used.has(c.wpPostId) && !view.taken.has(c.wpPostId) && (allowReuse || !dates.has(c.wpPostId)))
      .sort((a, b) => (dates.get(a.wpPostId) ?? -Infinity) - (dates.get(b.wpPostId) ?? -Infinity));
    const writer = await ports.writer.available(source.workspaceId).catch(() => false);
    const scan = await scanCandidates(db, s, source, config, now, found => !s.reuse.enabled && fresh(found).length >= s.previewCount, writer);
    const items: PreviewItem[] = [];
    for (const c of fresh(scan.candidates, scan.exhausted).slice(0, s.previewCount)) {
      // AI writes the same way at planning time; a preview it cannot write shows the post's own text and says so.
      const written = await writeCandidate(ports, actor, s, config, c).catch(() => null);
      // The autopilot puts its call to action on top of the first comment, as at planning time (2026-11-16).
      const pilot = autopilotOf(config.autopilot);
      const comment = written?.firstComment ?? commentFor(s, config, c);
      items.push({ wpPostId: c.wpPostId, title: c.title, permalink: c.permalink, imageUrl: c.imageUrl, caption: written?.caption ?? c.caption, firstComment: pilot.comment.enabled ? withCta(comment, ctaFor(pilot.comment.cta, c.wpPostId), s.commentMax) : comment, publishedAt: c.publishedAt?.toISOString() ?? null, ...(c.write ? { writtenByAi: Boolean(written) } : {}) });
    }
    await addAutopilotPreview(items, { ports, actor, source, config, settings: s, writer, now }).catch(() => undefined);
    return { items, scanned: scan.scanned, exhausted: scan.exhausted, rejected: scan.rejected, captionsPerChannel: autopilotOf(config.autopilot).captions.enabled && writer };
  } catch (error) {
    if (error instanceof OperationError) throw error;
    throw await feedsError('upstream_failure', 'The recipe library could not be read. Try again later.');
  } finally { await db.close(); }
}

const MANUAL_RUN_MS = 45_000;
/** Plan now, as the signed-in member: creates scheduled posts for unfilled slots, bounded by the run budget. */
export async function runRecipePlannerNow(actor: FeedActor, input: unknown, deps: RecipeDeps = {}) {
  const s = await loadWordpressSettings();
  // Writing each post with AI takes seconds; a member's request stops in time and the hourly run plans the rest.
  const deadline = Date.now() + MANUAL_RUN_MS;
  const data = await parse(confirmSchema, input);
  if (data.confirmation !== runRecipePlannerConfirmation) throw await bad();
  const { auth, source } = await authorizedSource(actor);
  if (!s.enabled) throw await feedsError('unavailable', 'Recipe planning is not available right now.');
  if (!source.enabled) throw await feedsError('conflict', 'This recipe source is paused. Resume it to plan posts.');
  const ports = { ...defaultPlannerPorts(), ...deps };
  const db = await openDatabase(ports, s, source);
  if (!db) throw await feedsError('unavailable', 'The recipe library could not be reached. Try again later.');
  const now = ports.now();
  try {
    const outcome = await planSource({ settings: s, ports, db, budget: { left: s.runBudget }, now, deadline }, source, auth);
    forgetPoolHealth(source.id);
    await ports.store.recordRun(actor.workspaceId, source.id, { at: now, error: null, summary: recipeSummaryRecord(outcome, now) }).catch(() => undefined);
    await audit(prisma as unknown as Tx, actor.workspaceId, actor, 'feeds.recipe_planner_run', { sourceId: source.id, planned: outcome.planned, failed: outcome.failed, uncertain: outcome.uncertain, unfilled: outcome.unfilled }).catch(() => undefined);
    return outcome;
  } catch (error) {
    if (error instanceof OperationError) throw error;
    throw await feedsError('upstream_failure', 'Planning could not be completed. Check the planned posts before trying again.');
  } finally { await db.close(); }
}
