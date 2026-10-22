/**
 * Synthetic-only HTTP/MCP/PostgreSQL/Chromium probe for Analytics Reports (batch 82).
 * It requires DATABASE_URL === REBUILD_PREVIEW_DATABASE_URL pointing to loopback PostgreSQL whose database name
 * ends in _preview, REBUILD_PREVIEW_ORIGIN=http://localhost:3200, and a running local production-build preview.
 * It never calls a provider or email service. Manual report generation is intentionally verified with delivery disabled.
 * All credentials remain in memory. Only uniquely named synthetic rows and a bounded set of exact Root settings are touched.
 * Run from rebuild/ after the parent has built and started the candidate: node --import tsx scripts/verify-reports82.ts
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { chromium, type Browser, type Page } from 'playwright';
import { Prisma, PrismaClient } from '../generated/client';
import { CONFIG_SCHEMA_VERSION } from '../src/lib/config/registry';
import { hashSessionToken } from '../src/server/auth';

class ProbeFailure extends Error {}
function check(value: unknown, message: string): asserts value { if (!value) throw new ProbeFailure(message); }
const failures: string[] = [];
let stage = 'preflight';
const run = promisify(execFile);
const expect = (value: unknown, message: string) => { if (!value) failures.push(`[${stage}] ${message}`); };
type Setting = { key: string; value: Prisma.JsonValue; encrypted: boolean; updatedAt: Date };
const settingKeys = [
  'platforms.facebook.enabled', 'entitlements.modules.analytics', 'entitlements.modules.settings',
  'entitlements.features.analytics/reports', 'entitlements.features.settings/mcp',
  'mcp.enabled', 'mcp.authenticatedRoles', 'mcp.maxResultItems',
  'analytics.reports.requestMaxBytes',
  'analytics.reports.deliveryEnabled', 'jobs.enabled',
  'entitlements.features.settings/data', 'storage.mediaRoot',
] as const;

async function main() {
  const raw = process.env.REBUILD_PREVIEW_DATABASE_URL;
  const origin = process.env.REBUILD_PREVIEW_ORIGIN;
  check(raw && raw === process.env.DATABASE_URL && origin && process.env.NODE_ENV !== 'production', 'Set matching DATABASE_URL and REBUILD_PREVIEW_DATABASE_URL, an explicit local origin, and non-production NODE_ENV.');
  const dbUrl = new URL(raw), base = new URL(origin);
  check(['postgres:', 'postgresql:'].includes(dbUrl.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(dbUrl.hostname)
    && decodeURIComponent(dbUrl.pathname).endsWith('_preview') && !['host', 'hostaddr', 'socket'].some(key => dbUrl.searchParams.has(key)), 'Only loopback PostgreSQL databases ending in _preview are allowed.');
  check(base.origin === origin && origin === 'http://localhost:3200', 'Only the exact localhost:3200 preview is allowed.');

  const db = new PrismaClient({ datasources: { db: { url: raw } } });
  const tag = `preview_reports82_${randomUUID().replaceAll('-', '')}`;
  const shortTag = `R82-${randomUUID().slice(0, 8)}`;
  const id = (name: string) => `${tag}_${name}`;
  const userId = id('owner'), workspaceId = id('workspace'), membershipId = id('membership'), sessionId = id('session');
  const targetId = id('channel'), orphanId = id('orphan'), accountId = id('account');
  const connectionId = id('connection');
  const templateIds: string[] = [], scheduleIds: string[] = [], runIds: string[] = [], keyIds: string[] = [];
  const sessionToken = randomBytes(32).toString('base64url');
  const cookie = `msp_session=${sessionToken}; sp_workspace=${workspaceId}`;
  const mcpTokens = { all: `mcp_${randomBytes(32).toString('base64url')}`, selected: `mcp_${randomBytes(32).toString('base64url')}`, empty: `mcp_${randomBytes(32).toString('base64url')}`, readOnly: `mcp_${randomBytes(32).toString('base64url')}` };
  const keyPrefix = (token: string) => token.slice(0, 12);
  const sha = (token: string) => createHash('sha256').update(token).digest('hex');
  const settings = new Map<string, Setting | null>();
  const recoveryPath = `/private/tmp/${tag}-recovery.json`;
  const mediaRoot = `/private/tmp/${tag}-media`;
  const exportPath = `/private/tmp/${tag}-workspace-export.zip`;
  let settingsCaptured = false, recoverySaved = false, fixturesStarted = false;
  let mediaRootCreated = false;
  let cleanupFailed = false, summary: Record<string, unknown> | undefined;
  let browser: Browser | undefined;

  type Response = { status: number; headers: Headers; text: string; body: any };
  async function http(path: string, options: { method?: string; body?: unknown; cookie?: string; bearer?: string; origin?: string | null } = {}): Promise<Response> {
    const headers: Record<string, string> = { ...(options.origin === null ? {} : { origin: options.origin ?? base.origin }), ...(options.cookie ? { cookie: options.cookie } : {}), ...(options.bearer ? { authorization: `Bearer ${options.bearer}` } : {}), ...(options.body === undefined ? {} : { 'content-type': 'application/json' }) };
    const response = await fetch(new URL(path, base), { method: options.method ?? 'GET', headers, redirect: 'manual', signal: AbortSignal.timeout(30000), ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }) });
    const text = await response.text(); let body: any = null; try { body = JSON.parse(text); } catch { /* keep null */ }
    return { status: response.status, headers: response.headers, text, body };
  }
  async function rpc(method: string, params: unknown, bearer: string) {
    const response = await fetch(new URL('/api/mcp?scope=workspace', base), { method: 'POST', headers: { origin: base.origin, 'content-type': 'application/json', authorization: `Bearer ${bearer}` }, body: JSON.stringify({ jsonrpc: '2.0', id: randomUUID(), method, params }), redirect: 'manual', signal: AbortSignal.timeout(30000) });
    const text = await response.text(); let body: any = null; try { body = JSON.parse(text); } catch { /* keep null */ }
    return { status: response.status, text, body };
  }
  async function tool(bearer: string, name: string, args: unknown = {}) {
    const response = await rpc('tools/call', { name, arguments: args }, bearer);
    const result = response.body?.result;
    const content = result?.content?.find((part: any) => part?.type === 'text')?.text ?? '';
    let data: any = result?.structuredContent ?? null; if (!data && content) try { data = JSON.parse(content); } catch { /* keep null */ }
    return { ...response, result, data, refused: response.status >= 400 || response.body?.error !== undefined || result?.isError === true };
  }
  async function saveSetting(key: string, value: unknown) {
    const response = await http('/api/root/config', { method: 'PUT', cookie, body: { key, value } });
    check(response.status === 200 && response.body?.schemaVersion === CONFIG_SCHEMA_VERSION, `Root setting ${key} did not save.`);
  }
  const templateConfirm = (name: string) => `CREATE REPORT TEMPLATE ${name}`;
  const scheduleConfirm = (channel: string, frequency: string) => `CREATE REPORT SCHEDULE ${channel} ${frequency}`;
  const runConfirm = (channel: string) => `GENERATE CHANNEL REPORT ${channel}`;
  const query = <T = any>(sql: Prisma.Sql) => db.$queryRaw<T[]>(sql);
  const reportCount = async (table: 'report_templates' | 'report_schedules' | 'report_runs') => Number((await query<{ n: bigint }>(Prisma.sql`SELECT COUNT(*)::bigint AS n FROM ${Prisma.raw(table)} WHERE "workspaceId"=${workspaceId}`))[0]?.n ?? 0);

  async function renderReports(width: number, theme: 'grove' | 'nightfall', action?: (page: Page) => Promise<void>) {
    browser ??= await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    try {
      await context.addCookies(cookie.split('; ').map(item => { const pos = item.indexOf('='); return { name: item.slice(0, pos), value: item.slice(pos + 1), url: base.origin, httpOnly: true, sameSite: 'Lax' as const }; }));
      await context.route('**/*', route => new URL(route.request().url()).origin === base.origin ? route.continue() : route.abort());
      const page = await context.newPage();
      await page.goto(new URL('/analytics/reports', base).href, { waitUntil: 'networkidle', timeout: 30000 });
      await page.locator('#main-content').waitFor({ state: 'visible', timeout: 10000 });
      await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
      if (action) await action(page);
      await page.screenshot({path:`/private/tmp/reports82-${width}-${theme}.png`,fullPage:true});
      return {
        heading: await page.locator('h1').first().innerText(),
        overflow: await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1),
        theme: await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--canvas').trim()),
        text: await page.locator('#main-content').innerText(),
      };
    } finally { await context.close(); }
  }

  try {
    check((await fetch(new URL('/sign-in', base), { redirect: 'manual', signal: AbortSignal.timeout(5000) })).status < 500, 'Local preview is not responding.');
    const schema = await query<{ ready: boolean }>(Prisma.sql`SELECT to_regclass('public.report_templates') IS NOT NULL AND to_regclass('public.report_schedules') IS NOT NULL AND to_regclass('public.report_runs') IS NOT NULL AND to_regclass('public.page_insights') IS NOT NULL AS ready`);
    check(schema[0]?.ready, 'Reports tables are missing from the preview database; no fixture was written.');
    for (const key of settingKeys) {
      const row = await db.appSetting.findUnique({ where: { key }, select: { key: true, value: true, encrypted: true, updatedAt: true } });
      check(!row?.encrypted, `Unexpected encrypted Root setting ${key}.`);
      settings.set(key, row);
    }
    settingsCaptured = true;
    await writeFile(recoveryPath, JSON.stringify({ tag, workspaceId, userId, mediaRoot, exportPath, settings: [...settings] }), { mode: 0o600, flag: 'wx' }); recoverySaved = true;
    fixturesStarted = true;

    stage = 'synthetic fixture setup';
    const now = new Date();
    await db.user.create({ data: { id: userId, email: `${userId}@example.invalid`, name: 'Disposable Reports QA owner', passwordHash: 'unusable-preview-password', isInstanceOwner: true, totpEnabledAt: now } });
    await db.workspace.create({ data: { id: workspaceId, name: `${tag} Reports QA`, slug: workspaceId, timezone: 'Africa/Casablanca' } });
    await db.membership.create({ data: { id: membershipId, workspaceId, userId, role: 'owner' } });
    await db.session.create({ data: { id: sessionId, userId, tokenHash: hashSessionToken(sessionToken)!, expiresAt: new Date(Date.now() + 3600000), pending: null } });
    await db.socialAccount.create({ data: { id: connectionId, workspaceId, provider: 'facebook', providerUserId: id('provider'), name: 'Synthetic Reports connection', accessToken: 'synthetic-never-used', scopes: '' } });
    await db.target.create({ data: { id: targetId, workspaceId, socialAccountId: connectionId, type: 'page', providerId: id('provider_channel'), name: 'Synthetic Reports channel', enabled: true, canPublish: false, createdAt: now } });
    await db.target.create({ data: { id: orphanId, workspaceId, type: 'page', providerId: id('orphan_provider'), name: 'Synthetic Reports orphan', enabled: true, canPublish: false, createdAt: now } });
    // A single synthetic metric gives the exported report content without contacting a platform.
    await db.pageInsight.create({ data: { id: id('insight'), targetId, metric: 'page_follows', period: 'day', endTime: new Date(Date.now() - 86400000), value: 41, numeric: 41, fetchedAt: now } });

    const keyData = (name: string, token: string, scope: unknown, read: string[], write: string[]) => db.mcpApiKey.create({ data: { id: id(`key_${name}`), workspaceId, createdById: userId, name: `${shortTag} ${name}`, tokenHash: sha(token), tokenPrefix: keyPrefix(token), readFeatures: read, writeFeatures: write, resourceScope: scope === null ? Prisma.DbNull : scope as Prisma.InputJsonValue, expiresAt: new Date(Date.now() + 3600000) } });
    const restricted = (ids: string[]) => ({ version: 1, mode: 'selected', ids, adAccountIds: [] });
    const allFeatures = ['analytics/reports'];
    const [allKey, selectedKey, emptyKey, readOnlyKey] = await Promise.all([
      keyData('all', mcpTokens.all, null, allFeatures, allFeatures),
      keyData('selected', mcpTokens.selected, restricted([targetId]), allFeatures, allFeatures),
      keyData('empty', mcpTokens.empty, restricted([]), allFeatures, allFeatures),
      keyData('read-only', mcpTokens.readOnly, null, allFeatures, []),
    ]);
    keyIds.push(allKey.id, selectedKey.id, emptyKey.id, readOnlyKey.id);

    stage = 'Root config and cold manual generation without delivery';
    await saveSetting('platforms.facebook.enabled', true);
    await saveSetting('entitlements.modules.analytics', true);
    await saveSetting('entitlements.modules.settings', true);
    await saveSetting('entitlements.features.analytics/reports', true);
    await saveSetting('entitlements.features.settings/mcp', true);
    await saveSetting('entitlements.features.settings/data', true);
    await saveSetting('mcp.enabled', true);
    await saveSetting('mcp.authenticatedRoles', ['owner', 'admin']);
    await saveSetting('mcp.maxResultItems', 100);
    await saveSetting('analytics.reports.deliveryEnabled', false);
    await saveSetting('jobs.enabled', false);
    const start = new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10);
    const end = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const requestId = randomUUID();
    const manualBody = { channelId: targetId, templateId: null, start, end, requestId, confirmation: runConfirm(targetId) };
    const cold = await http('/api/analytics/report-workflows/run', { method: 'POST', cookie, body: manualBody });
    expect(cold.status === 201 && cold.body?.ok === true && cold.body?.outcome === 'prepared' && cold.body?.filename, `Cold manual generation must work with delivery disabled (HTTP ${cold.status}).`);
    if (cold.body?.runId) runIds.push(cold.body.runId);
    expect(typeof cold.body?.csv === 'string' && cold.body.csv.includes('metric_key') && typeof cold.body?.html === 'string', 'Manual output must include CSV and printable HTML.');
    expect(typeof cold.body?.csv === 'string' && cold.body.csv.includes('41'), 'Synthetic stored metric must be present in the report.');
    // Omit Content-Length and stream beyond the active Root ceiling to exercise actual byte counting.
    await saveSetting('analytics.reports.requestMaxBytes', 4096);
    const oversizedText = JSON.stringify({ ...manualBody, padding: 'x'.repeat(6000), requestId: randomUUID() });
    const oversizedBytes = new TextEncoder().encode(oversizedText);
    const oversizedStream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let offset = 0; offset < oversizedBytes.length; offset += 1024) controller.enqueue(oversizedBytes.slice(offset, offset + 1024));
        controller.close();
      },
    });
    const oversizedResponse = await fetch(new URL('/api/analytics/report-workflows/run', base), {
      method: 'POST',
      headers: { origin: base.origin, cookie, 'content-type': 'application/json' },
      body: oversizedStream,
      // Node's fetch requires duplex for a streaming request body and does not add Content-Length.
      duplex: 'half',
      redirect: 'manual',
      signal: AbortSignal.timeout(30000),
    } as RequestInit & { duplex: 'half' });
    expect(oversizedResponse.status === 413 || oversizedResponse.status === 400, `A streamed request over the active Root byte limit must be rejected (${oversizedResponse.status}).`);
    await saveSetting('analytics.reports.requestMaxBytes', 65536);
    const replay = await http('/api/analytics/report-workflows/run', { method: 'POST', cookie, body: manualBody });
    expect(replay.status === 201 && replay.body?.replayed === true && replay.body?.runId === cold.body?.runId && replay.body?.csv === cold.body?.csv, 'An identical request ID must replay its retained output.');
    const secondManual = await http('/api/analytics/report-workflows/run', { method: 'POST', cookie, body: { ...manualBody, requestId: randomUUID() } });
    expect(secondManual.status === 201 && secondManual.body?.outcome === 'prepared', `A second distinct manual run should be retained for bounded history checks (${secondManual.status}).`);
    const mismatch = await http('/api/analytics/report-workflows/run', { method: 'POST', cookie, body: { ...manualBody, end: start } });
    expect(mismatch.status === 409, `A request ID reused for different dates must conflict (${mismatch.status}).`);
    const wrongConfirmation = await http('/api/analytics/report-workflows/run', { method: 'POST', cookie, body: { ...manualBody, requestId: randomUUID(), confirmation: 'PREPARE' } });
    expect(wrongConfirmation.status === 400, 'Manual generation must reject a non-exact confirmation.');

    stage = 'template and schedule HTTP lifecycle';
    const title = `${shortTag} weekly layout`;
    const createTemplate = await http('/api/analytics/report-workflows/templates', { method: 'POST', cookie, body: { action: 'create', name: title, sections: ['analysis', 'audience'], rangeKey: '30d', confirmation: templateConfirm(title) } });
    expect(createTemplate.status === 201 && createTemplate.body?.ok === true, `Template creation failed (${createTemplate.status}).`);
    const templateId = createTemplate.body?.id; if (templateId) templateIds.push(templateId);
    const wrongTemplateConfirmation = await http('/api/analytics/report-workflows/templates', { method: 'POST', cookie, body: { action: 'create', name: `${title} wrong`, sections: ['analysis'], rangeKey: '30d', confirmation: 'yes' } });
    expect(wrongTemplateConfirmation.status === 400, 'Template creation must reject an inexact confirmation.');
    if (templateId) {
      const update = await http('/api/analytics/report-workflows/templates', { method: 'POST', cookie, body: { action: 'update', id: templateId, name: `${title} updated`, sections: ['analysis'], rangeKey: '90d', confirmation: `UPDATE REPORT TEMPLATE ${templateId}` } });
      expect(update.status === 200, `Template update failed (${update.status}).`);
      const list = await http('/api/analytics/report-workflows/templates', { cookie });
      expect(list.status === 200 && list.body?.templates?.some((item: any) => item.id === templateId && item.name === `${title} updated`), 'Template list must expose the updated saved template.');
    }
    // Seed an existing definition directly so editing/deletion remains testable when email delivery is unavailable.
    const scheduleId = id('schedule'); scheduleIds.push(scheduleId);
    await query(Prisma.sql`INSERT INTO report_schedules (id,"workspaceId","templateId","targetId",frequency,recipients,"nextRunAt","aiRecap","createdById","createdAt") VALUES (${scheduleId},${workspaceId},${templateId ?? null},${targetId},'weekly',ARRAY['reports82@example.invalid']::text[],${new Date(Date.now() + 45 * 86400000)},false,${userId},${now})`);
    const editSchedule = await http('/api/analytics/report-workflows/schedules', { method: 'POST', cookie, body: { action: 'update', id: scheduleId, frequency: 'monthly', recipients: ['changed@example.invalid'], templateId: templateId ?? null, confirmation: `UPDATE REPORT SCHEDULE ${scheduleId}` } });
    expect(editSchedule.status === 200, `Existing schedules must remain editable when delivery is disabled (${editSchedule.status}).`);
    const listSchedules = await http('/api/analytics/report-workflows/schedules', { cookie });
    expect(listSchedules.status === 200 && listSchedules.body?.schedules?.some((item: any) => item.id === scheduleId && item.frequency === 'monthly' && item.channelAvailable), 'Schedule listing must report the current channel and edited frequency.');
    const invalidScheduleCreate = await http('/api/analytics/report-workflows/schedules', { method: 'POST', cookie, body: { action: 'create', channelId: targetId, frequency: 'weekly', recipients: ['reports82@example.invalid'], templateId: null, confirmation: scheduleConfirm(targetId, 'weekly') } });
    expect([400, 409, 502, 503].includes(invalidScheduleCreate.status), `Schedule creation should remain unavailable while mail delivery is disabled (${invalidScheduleCreate.status}).`);
    const deleteSchedule = await http('/api/analytics/report-workflows/schedules', { method: 'POST', cookie, body: { action: 'delete', id: scheduleId, confirmation: `DELETE REPORT SCHEDULE ${scheduleId}` } });
    expect(deleteSchedule.status === 200, `Existing schedule deletion failed (${deleteSchedule.status}).`);
    scheduleIds.length = 0;
    if (templateId) {
      const deleteTemplate = await http('/api/analytics/report-workflows/templates', { method: 'POST', cookie, body: { action: 'delete', id: templateId, confirmation: `DELETE REPORT TEMPLATE ${templateId}` } });
      expect(deleteTemplate.status === 200, `Template deletion failed (${deleteTemplate.status}).`);
      templateIds.length = 0;
    }

    stage = 'current channel authority and MCP ceilings/resources';
    const toolNames = async (token: string) => (await rpc('tools/list', {}, token)).body?.result?.tools?.map((item: any) => item.name) ?? [];
    const allNames = await toolNames(mcpTokens.all), scopedNames = await toolNames(mcpTokens.selected), emptyNames = await toolNames(mcpTokens.empty), readNames = await toolNames(mcpTokens.readOnly);
    expect(allNames.includes('generate_report') && allNames.includes('list_report_runs'), 'All-resource MCP key must discover generation and history tools.');
    expect(!scopedNames.includes('list_report_templates') && !scopedNames.includes('manage_report_template'), 'Selected-resource key must not discover workspace-wide template tools.');
    expect(!emptyNames.includes('generate_report') || (await tool(mcpTokens.empty, 'generate_report', { requestId: randomUUID(), channelId: targetId, start, end, confirmation: runConfirm(targetId) })).refused, 'An explicit empty channel ceiling must not generate channel data.');
    expect(readNames.includes('list_report_runs') && !readNames.includes('generate_report') && !readNames.includes('manage_report_schedule'), 'Read-only MCP key must list but not mutate or generate reports.');
    const selectedRuns = await tool(mcpTokens.selected, 'list_report_runs');
    expect(!selectedRuns.refused && (selectedRuns.data?.runs ?? []).every((run: any) => run.channelId === targetId), 'Selected-resource key must list only runs within its channel ceiling.');
    const readRuns = await tool(mcpTokens.readOnly, 'list_report_runs');
    expect(!readRuns.refused && Array.isArray(readRuns.data?.runs), 'Read-only MCP key must read report history.');
    await saveSetting('mcp.maxResultItems', 1);
    const boundedRuns = await tool(mcpTokens.selected, 'list_report_runs');
    expect(!boundedRuns.refused && boundedRuns.data?.runs?.length === 1 && boundedRuns.data?.hasMore === true, 'MCP report history must apply the current result ceiling.');
    await saveSetting('mcp.maxResultItems', 100);
    const selectedResources = await rpc('resources/list', {}, mcpTokens.selected);
    const selectedUris: string[] = selectedResources.body?.result?.resources?.map((item: any) => item.uri) ?? [];
    expect(selectedUris.includes('msp://analytics/reports/schedules') && selectedUris.includes('msp://analytics/reports/runs') && !selectedUris.includes('msp://analytics/reports/templates'), 'Selected-resource MCP resources must expose only channel-scoped reports.');
    const selectedRunsResource = await rpc('resources/read', { uri: 'msp://analytics/reports/runs' }, mcpTokens.selected);
    expect(selectedRunsResource.body?.error === undefined, 'Selected-resource key must read the run-history resource.');
    const deniedTemplateResource = await rpc('resources/read', { uri: 'msp://analytics/reports/templates' }, mcpTokens.selected);
    expect(deniedTemplateResource.body?.error !== undefined, 'Selected-resource key must not read the workspace template resource.');
    const readOnlyWrite = await tool(mcpTokens.readOnly, 'manage_report_schedule', { action: 'delete', id: scheduleId, confirmation: `DELETE REPORT SCHEDULE ${scheduleId}` });
    expect(readOnlyWrite.refused, 'Read-only MCP keys must be refused for schedule mutations.');
    const wrongMcpConfirmation = await tool(mcpTokens.all, 'manage_report_template', { action: 'create', name: `${shortTag} wrong`, sections: ['analysis'], rangeKey: '30d', confirmation: 'yes' });
    expect(wrongMcpConfirmation.refused, 'MCP template writes must require the exact confirmation string.');
    const mcpTemplateName = `${shortTag} MCP template`;
    const mcpCreate = await tool(mcpTokens.all, 'manage_report_template', { action: 'create', name: mcpTemplateName, sections: ['analysis'], rangeKey: '30d', confirmation: templateConfirm(mcpTemplateName) });
    expect(!mcpCreate.refused && typeof mcpCreate.data?.id === 'string', 'All-resource MCP key must create a template with the exact confirmation.');
    if (mcpCreate.data?.id) {
      const mcpId = mcpCreate.data.id as string; templateIds.push(mcpId);
      const mcpDelete = await tool(mcpTokens.all, 'manage_report_template', { action: 'delete', id: mcpId, confirmation: `DELETE REPORT TEMPLATE ${mcpId}` });
      expect(!mcpDelete.refused, 'All-resource MCP key must delete a template with the exact confirmation.');
      templateIds.splice(templateIds.indexOf(mcpId), 1);
    }
    const mcpRunId = randomUUID();
    const mcpGenerated = await tool(mcpTokens.selected, 'generate_report', { channelId: targetId, start, end, templateId: null, requestId: mcpRunId, confirmation: runConfirm(targetId) });
    expect(!mcpGenerated.refused && mcpGenerated.data?.outcome === 'prepared', 'Selected-resource MCP key must prepare an authorized channel report.');
    const mcpMismatch = await tool(mcpTokens.selected, 'generate_report', { channelId: orphanId, start, end, templateId: null, requestId: mcpRunId, confirmation: runConfirm(orphanId) });
    expect(mcpMismatch.refused, 'MCP report generation must enforce current channel scope and request identity.');
    const allResources = await rpc('resources/list', {}, mcpTokens.all);
    const allUris: string[] = allResources.body?.result?.resources?.map((item: any) => item.uri) ?? [];
    expect(allUris.includes('msp://analytics/reports/templates') && allUris.includes('msp://analytics/reports/schedules') && allUris.includes('msp://analytics/reports/runs'), 'All-resource key must discover all report resources.');

    stage = 'connection invalidation and selection changes';
    const runsBefore = await reportCount('report_runs');
    await db.socialAccount.update({ where: { id: connectionId }, data: { invalidatedAt: new Date(), invalidReason: 'synthetic probe' } });
    const invalidatedReplay = await http('/api/analytics/report-workflows/run', { method: 'POST', cookie, body: manualBody });
    expect(invalidatedReplay.status === 400 || invalidatedReplay.status === 403, `Replay must recheck the invalidated connection (${invalidatedReplay.status}).`);
    await db.socialAccount.update({ where: { id: connectionId }, data: { invalidatedAt: null, invalidReason: null } });
    await db.target.update({ where: { id: targetId }, data: { enabled: false } });
    const deselectedReplay = await http('/api/analytics/report-workflows/run', { method: 'POST', cookie, body: manualBody });
    expect(deselectedReplay.status === 400 || deselectedReplay.status === 403, `Replay must recheck current destination selection (${deselectedReplay.status}).`);
    await db.target.update({ where: { id: targetId }, data: { enabled: true } });
    const orphan = await http('/api/analytics/report-workflows/run', { method: 'POST', cookie, body: { ...manualBody, channelId: orphanId, requestId: randomUUID(), confirmation: runConfirm(orphanId) } });
    expect(orphan.status === 400 || orphan.status === 403, 'An enabled orphan channel without a current connection must not generate reports.');
    expect(await reportCount('report_runs') === runsBefore, 'Refused replay, deselection and orphan attempts must not add report runs.');

    stage = 'Chromium desktop and phone UX';
    const desktop = await renderReports(1440, 'grove', async page => {
      await page.getByRole('button', { name: 'Prepare report' }).click();
      const form = page.getByRole('dialog', { name: 'Prepare report' });
      await form.locator('#report-manual-start').fill(end);
      await form.locator('#report-manual-end').fill(start);
      await form.getByRole('button', { name: 'Review report' }).click();
      await form.getByText(/valid start date/).waitFor({ state: 'visible' });
      const focused = await page.evaluate(() => (document.activeElement as HTMLElement | null)?.id);
      expect(focused === 'report-manual-start', `First invalid date should receive focus (got ${focused}).`);
      expect(await form.locator('#report-manual-end').inputValue() === start, 'Validation must preserve the entered date range.');
      await form.locator('#report-manual-start').fill(start);
      await form.locator('#report-manual-end').fill(end);
      await form.getByRole('button', { name: 'Review report' }).click();
      const review = page.getByRole('dialog', { name: 'Prepare this report?' });
      await review.getByRole('checkbox').check();
      let interrupted = false;
      await page.route('**/api/analytics/report-workflows/run', async route => {
        if (!interrupted && route.request().method() === 'POST') { interrupted = true; await route.abort('failed'); }
        else await route.continue();
      });
      const postedIds: string[] = [];
      page.on('request', request => {
        if (request.url().endsWith('/api/analytics/report-workflows/run') && request.method() === 'POST') {
          try { postedIds.push(request.postDataJSON().requestId); } catch { /* malformed body is covered by endpoint behavior */ }
        }
      });
      await review.getByRole('button', { name: 'Prepare report' }).click();
      await review.getByRole('alert').waitFor({ state: 'visible' });
      expect((await review.innerText()).includes('could not be confirmed'), 'Network failure should keep the confirmation context and explain uncertainty.');
      await review.getByRole('button', { name: 'Prepare report' }).click();
      await page.getByRole('region', { name: 'Report prepared' }).waitFor({ state: 'visible', timeout: 30000 });
      expect(postedIds.length === 2 && postedIds[0] === postedIds[1], 'A browser retry must reuse the same request id after an uncertain response.');
    });
    expect(desktop.heading === 'Saved reports and schedules', 'Desktop Reports page title should render.');
    expect(!desktop.overflow, 'Desktop Reports page must not overflow horizontally at 1440px.');
    expect(desktop.theme.length > 0, 'Grove theme tokens should resolve in the rendered UI.');
    const phone = await renderReports(390, 'nightfall', async page => {
      await page.getByRole('button', { name: 'Menu & filters' }).click();
      const navigation = page.getByRole('dialog', { name: 'Analytics navigation' });
      await navigation.getByRole('button', { name: 'Prepare report' }).click();
      const dialog = page.getByRole('dialog', { name: 'Prepare report' });
      expect(await dialog.isVisible(), 'Manual report dialog should open at phone width.');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'Phone report dialog must not cause page overflow.');
      expect(await page.locator('table').evaluateAll(nodes => nodes.some(node => { const wrapper = node.parentElement; return !!wrapper && wrapper.scrollWidth > wrapper.clientWidth; })), 'Wide report tables should scroll inside their own phone viewport.');
      await dialog.getByRole('button', { name: 'Cancel' }).click();
    });
    expect(!phone.overflow, 'Reports page must not overflow horizontally at 390px.');
    expect(phone.theme.length > 0, 'Nightfall theme tokens should resolve in the rendered UI.');

    stage = 'MCP read-only access and absence of SMTP/provider activity';
    expect((await rpc('tools/list', {}, mcpTokens.readOnly)).status === 200, 'Read-only MCP key should remain usable for reads.');
    expect(await reportCount('report_runs') >= 2, 'Manual HTTP and MCP runs should be present in durable history.');
    const auditRows = await query<{ n: bigint }>(Prisma.sql`SELECT COUNT(*)::bigint AS n FROM activity_logs WHERE "workspaceId"=${workspaceId} AND action LIKE 'analytics.report_%'`);
    expect(Number(auditRows[0]?.n ?? 0) >= 1, 'Report mutations should leave auditable history.');

    stage = 'actual workspace ZIP export and report history';
    const exportTemplateId=id('export_template'),exportScheduleId=id('export_schedule');
    await query(Prisma.sql`INSERT INTO report_templates (id,"workspaceId",name,sections,"rangeKey","createdAt") VALUES (${exportTemplateId},${workspaceId},'Synthetic export layout','["analysis"]'::jsonb,'30d',${now})`);
    await query(Prisma.sql`INSERT INTO report_schedules (id,"workspaceId","templateId","targetId",frequency,recipients,"nextRunAt","aiRecap","createdById","createdAt") VALUES (${exportScheduleId},${workspaceId},${exportTemplateId},${targetId},'weekly',ARRAY['reports82@example.invalid']::text[],${new Date(Date.now()+45*86400000)},false,${userId},${now})`);
    await mkdir(mediaRoot, { recursive: false, mode: 0o700 }); mediaRootCreated = true;
    await saveSetting('storage.mediaRoot', mediaRoot);
    const archiveResponse = await fetch(new URL('/api/settings/data', base), { headers: { origin: base.origin, cookie }, redirect: 'manual', signal: AbortSignal.timeout(30000) });
    expect(archiveResponse.status === 200 && archiveResponse.headers.get('content-type')?.includes('application/zip'), `Actual workspace export must return a ZIP (${archiveResponse.status}).`);
    if (archiveResponse.status === 200) {
      const archive = Buffer.from(await archiveResponse.arrayBuffer());
      await writeFile(exportPath, archive, { mode: 0o600, flag: 'wx' });
      const { stdout } = await run('unzip', ['-p', exportPath, 'database/workspace.json'], { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 });
      const exported = JSON.parse(Buffer.from(stdout as Buffer).toString('utf8'));
      const runs = exported?.legacyTables?.report_runs;
      const schedules = exported?.legacyTables?.report_schedules;
      const templates = exported?.legacyTables?.report_templates;
      expect(exported?.format === 'ms-social-pilot-workspace-export' && exported?.workspace?.id === workspaceId, 'ZIP database entry must contain this workspace export.');
      expect(Array.isArray(runs) && runs.some((row: any) => row.id === cold.body?.runId), 'ZIP database entry must include the HTTP-created report run and its history.');
      expect(Array.isArray(schedules) && schedules.some((row: any) => row.id === exportScheduleId), 'ZIP database entry must include the existing report schedule.');
      expect(Array.isArray(templates) && templates.some((row: any) => row.id === exportTemplateId), 'ZIP database entry must include the saved report template.');
      const manifest = await run('unzip', ['-p', exportPath, 'manifest.json'], { encoding: 'buffer', maxBuffer: 2 * 1024 * 1024 });
      const manifestData = JSON.parse(Buffer.from(manifest.stdout as Buffer).toString('utf8'));
      expect(manifestData?.workspaceId === workspaceId && manifestData?.database?.file === 'database/workspace.json', 'ZIP manifest must identify the exported workspace and database entry.');
    }

    stage = 'actual workspace erasure of reports and media';
    const erased = await http('/api/settings/data', { method: 'DELETE', cookie, body: { confirmation: 'DELETE' } });
    expect(erased.status === 200 && erased.body?.ok === true, `Actual workspace erasure must complete (${erased.status}).`);
    expect(await reportCount('report_runs') === 0 && await reportCount('report_schedules') === 0 && await reportCount('report_templates') === 0, 'Actual erasure must remove this workspace report history, schedules and templates.');
    const purge = await db.workspaceDataPurge.findUnique({ where: { workspaceId }, select: { status: true, mediaRoot: true } });
    expect(purge?.status === 'completed' && purge.mediaRoot === mediaRoot, 'Erasure must complete against the unique probe media root.');
    summary = { preview: 'loopback-only', manualWithoutDelivery: cold.status === 201, sameIdReplay: replay.body?.replayed === true, hashMismatchRefused: mismatch.status === 409, templateHttpCrud: true, scheduleExistingEditDelete: true, scheduleCreateUnavailableWithoutMail: true, mcpResourceCeilings: true, actualZipExportIncludesReports: true, actualWorkspaceErasureRemovesReports: erased.status === 200, noProviderCalls: true, browser: { desktop1440: !desktop.overflow, phone390Nightfall: !phone.overflow, validationFocusAndRetry: true }, remaining: ['No SMTP delivery or scheduled worker run was performed by this probe.'] };
  } finally {
    stage = 'cleanup and exact Root-setting restoration';
    if (fixturesStarted) {
      try {
        await db.$transaction(async tx => {
          await tx.$executeRaw`DELETE FROM report_runs WHERE "workspaceId"=${workspaceId}`;
          await tx.$executeRaw`DELETE FROM report_schedules WHERE "workspaceId"=${workspaceId}`;
          await tx.$executeRaw`DELETE FROM report_templates WHERE "workspaceId"=${workspaceId}`;
          await tx.$executeRaw`DELETE FROM activity_logs WHERE "workspaceId"=${workspaceId}`;
          await tx.$executeRaw`DELETE FROM root_activities WHERE detail->>'workspaceId'=${workspaceId}`;
          await tx.$executeRaw`DELETE FROM root_activities WHERE "actorId"=${userId}`;
          await tx.mcpApiKey.deleteMany({ where: { workspaceId } });
          await tx.session.deleteMany({ where: { userId } });
          await tx.pageInsight.deleteMany({ where: { targetId } });
          await tx.target.deleteMany({ where: { id: { in: [targetId, orphanId] } } });
          await tx.socialAccount.deleteMany({ where: { id: connectionId } });
          await tx.membership.deleteMany({ where: { id: membershipId } });
          await tx.user.deleteMany({ where: { id: userId } });
          await tx.workspaceDataPurge.deleteMany({where:{workspaceId}});
          await tx.workspace.deleteMany({ where: { id: workspaceId } });
        });
      } catch (error) { cleanupFailed = true; failures.push(`[cleanup] Fixture cleanup failed: ${error instanceof Error ? error.message : 'unknown error'}`); }
    }
    if (settingsCaptured) {
      for (const key of settingKeys) {
        const row = settings.get(key) ?? null;
        try {
          if (row) await db.appSetting.upsert({ where: { key }, create: { key, value: row.value === null ? Prisma.JsonNull : row.value, encrypted: row.encrypted, updatedAt: row.updatedAt }, update: { value: row.value === null ? Prisma.JsonNull : row.value, encrypted: row.encrypted, updatedAt: row.updatedAt } });
          else await db.appSetting.deleteMany({ where: { key } });
        } catch (error) { cleanupFailed = true; failures.push(`[cleanup] Could not restore ${key}: ${error instanceof Error ? error.message : 'unknown error'}`); }
      }
      for (const key of settingKeys) {
        const actual = await db.appSetting.findUnique({ where: { key }, select: { key: true, value: true, encrypted: true, updatedAt: true } });
        const expected = settings.get(key) ?? null;
        if (JSON.stringify(actual) !== JSON.stringify(expected)) { cleanupFailed = true; failures.push(`[cleanup] Root setting ${key} did not return to its exact prior row.`); }
      }
    }
    if (mediaRootCreated) await rm(mediaRoot, { recursive: true, force: true }).catch(error => { cleanupFailed = true; failures.push(`[cleanup] Could not remove probe media root: ${error instanceof Error ? error.message : 'unknown error'}`); });
    await rm(exportPath, { force: true }).catch(error => { cleanupFailed = true; failures.push(`[cleanup] Could not remove private workspace ZIP: ${error instanceof Error ? error.message : 'unknown error'}`); });
    if (fixturesStarted) {
      const residue = await query<{ count: bigint }>(Prisma.sql`SELECT (SELECT COUNT(*) FROM workspaces WHERE id=${workspaceId}) + (SELECT COUNT(*) FROM users WHERE id=${userId}) + (SELECT COUNT(*) FROM report_templates WHERE "workspaceId"=${workspaceId}) + (SELECT COUNT(*) FROM report_schedules WHERE "workspaceId"=${workspaceId}) + (SELECT COUNT(*) FROM report_runs WHERE "workspaceId"=${workspaceId}) + (SELECT COUNT(*) FROM mcp_api_keys WHERE "workspaceId"=${workspaceId}) + (SELECT COUNT(*) FROM targets WHERE id = ANY(${[targetId, orphanId]}::text[])) AS count`);
      if (Number(residue[0]?.count ?? 0) !== 0) { cleanupFailed = true; failures.push('[cleanup] Synthetic Reports records remain in the preview database.'); }
    }
    if (browser) await browser.close().catch(() => undefined);
    if (recoverySaved && !cleanupFailed) await rm(recoveryPath, { force: true }).catch(error => failures.push(`[cleanup] Could not remove recovery ledger: ${error instanceof Error ? error.message : 'unknown error'}`));
    else if (recoverySaved && cleanupFailed) console.error(`[cleanup] Recovery ledger retained at ${recoveryPath}.`);
    await db.$disconnect().catch(() => undefined);
  }
  if (failures.length) {
    if (cleanupFailed && recoverySaved) failures.push(`[cleanup] Recovery ledger retained at ${recoveryPath}.`);
    console.error(failures.join('\n'));
    process.exitCode = 1;
  } else if (summary) console.log(JSON.stringify({ ...summary, passed: true, cleanup: 'clean' }));
}

main().catch(error => { console.error(error instanceof Error ? error.message : 'Reports probe failed.'); process.exitCode = 1; });
