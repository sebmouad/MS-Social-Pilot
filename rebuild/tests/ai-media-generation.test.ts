import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  overrides: {} as Record<string, unknown>, secret: 'sk-test' as string | null, member: true, workspaceOn: true, hourlyUsed: 0, role: 'owner',
  exec: [] as Array<{ sql: string; values: unknown[] }>, working: [] as Array<Record<string, unknown>>, videoStatus: 'working',
}));
const db = vi.hoisted(() => ({ $queryRaw: vi.fn(), $executeRaw: vi.fn(), $transaction: vi.fn() }));
const mocks = vi.hoisted(() => ({ entitlements: vi.fn(), permissions: vi.fn(), purge: vi.fn() }));
vi.mock('@/server/data', () => ({ prisma: db }));
vi.mock('@/server/entitlements', () => ({ loadEntitlements: mocks.entitlements, canUseFeature: (e: { features: Record<string, boolean> }, f: string) => e.features[f] === true }));
vi.mock('@/server/permissions/loader', () => ({ loadPermissions: mocks.permissions }));
vi.mock('@/server/data-control/guard', () => ({ assertWorkspaceNotPurging: mocks.purge, withWorkspaceOperation: (_id: string, fn: () => unknown) => fn() }));
vi.mock('@/modules/media/server/library', () => ({ bounds: async () => ({ quota: 1_000_000_000, videoMax: 500_000_000 }) }));
vi.mock('@/server/config/store', async () => {
  const { AI_CONFIG } = await import('../src/modules/ai/config');
  const defaults: Record<string, unknown> = { ...Object.fromEntries(AI_CONFIG.map(e => [e.key, e.defaultValue])), 'ai.enabled': true };
  const value = (key: string) => state.overrides[key] ?? defaults[key];
  return { runtimeConfig: async (key: string) => value(key), runtimeConfigBatch: async (keys: string[]) => Object.fromEntries(keys.map(key => [key, value(key)])), runtimeSecret: async () => state.secret };
});

import { resolvePermissions } from '../src/server/permissions';
import { aiMediaStatus, generateImage, generateVoice, listVideos, pollAiVideos, startVideo } from '../src/modules/ai/content-tools/server/media';
import { AI_CONTENT_TOOLS_DEFAULTS } from '../src/modules/ai/content-tools/config';
import { executeContentTool } from '../src/modules/ai/content-tools/mcp';

const actor = { userId: 'u1', workspaceId: 'w1' };
const sql = (s: TemplateStringsArray, v: unknown[]) => ({ sql: s.join('?'), values: v });
const png = Buffer.from([137, 80, 78, 71, 1, 2, 3]);
const enabled = (key: 'image' | 'voice' | 'video', extra: object = {}) => ({ ...AI_CONTENT_TOOLS_DEFAULTS[key], enabled: true, ...extra });
const store = () => ({
  listImages: vi.fn(async () => ({ items: [], truncated: false, totalFiles: 0, totalBytes: 0 })), inspectImage: vi.fn(),
  putImage: vi.fn(async () => ({ id: 'img-1', mimeType: 'image/png' })), putVideo: vi.fn(async (_w: string, id: string) => ({ storageKey: `w1/videos/${id}` })),
  removeImage: vi.fn(async () => 'deleted' as const), removeStored: vi.fn(async () => 'deleted' as const),
});
const imagePort = () => ({ listModels: vi.fn(async () => [{ id: 'gpt-image-9', created: 5 }]), generate: vi.fn(async () => png) });
const voicePort = () => ({ listModels: vi.fn(async () => [{ id: 'gpt-tts-9', created: 5 }]), speak: vi.fn(async () => Buffer.from('mp3')) });
const videoPort = (poll: object = { state: 'working' }) => ({ listModels: vi.fn(async () => [{ id: 'veo-9', created: 0 }]), start: vi.fn(async () => 'operations/abc'), poll: vi.fn(async () => poll as never), download: vi.fn(async () => Buffer.from('mp4')) });
const role = (value: string) => resolvePermissions({ role: value, workspaceDisabledModules: [], memberDisabledModules: [], clientAccess: [], allPages: true, pageAccess: [] });

beforeEach(() => {
  vi.clearAllMocks(); state.overrides = { 'ai.imagePolicy': enabled('image'), 'ai.voicePolicy': enabled('voice'), 'ai.videoPolicy': enabled('video') };
  state.secret = 'sk-test'; state.member = true; state.workspaceOn = true; state.hourlyUsed = 0; state.role = 'owner'; state.exec = []; state.working = []; state.videoStatus = 'working';
  mocks.entitlements.mockResolvedValue({ workspaceId: 'w1', features: { 'publishing/posts': true, 'publishing/media': true } });
  mocks.permissions.mockImplementation(async () => role(state.role));
  db.$transaction.mockImplementation(async (cb: (tx: typeof db) => Promise<unknown>) => cb(db));
  db.$queryRaw.mockImplementation(async (s: TemplateStringsArray, ...v: unknown[]) => {
    const q = sql(s, v);
    if (q.sql.includes('memberships m JOIN users')) return state.member && v.includes('w1') ? [{ role: state.role, disabledAt: null, suspendedAt: null }] : [];
    if (q.sql.includes('"aiEnabled"')) return [{ aiEnabled: state.workspaceOn, aiTone: null, aiBrandVoice: null, aiAvoidWords: null }];
    if (q.sql.includes('SUM((detail')) return [{ requests: 0, spent: 0, unpriced: 0 }];
    if (q.sql.includes("action = 'ai.requested'")) return [{ count: BigInt(state.hourlyUsed) }];
    if (q.sql.includes('SUM(size)')) return [{ bytes: 0 }];
    if (q.sql.includes("status = 'working'") && q.sql.includes('FROM ai_videos')) return state.working;
    if (q.sql.includes('SELECT status FROM ai_videos')) return [{ status: state.videoStatus }];
    if (q.sql.includes('FROM ai_videos')) return state.working;
    return [];
  });
  db.$executeRaw.mockImplementation(async (s: TemplateStringsArray, ...v: unknown[]) => { state.exec.push(sql(s, v)); return 1; });
});

describe('availability', () => {
  it('offers each kind that is on, keyed and permitted, with the exact confirmations', async () => {
    const status = await aiMediaStatus(actor, { ports: { image: imagePort(), voice: voicePort(), video: videoPort() } });
    expect(status.image).toMatchObject({ available: true, defaultSize: 'square' });
    expect(status.voice).toMatchObject({ available: true, defaultVoice: 'marin' });
    expect(status.video).toMatchObject({ available: true, defaultAspectRatio: '16:9' });
    expect(status.confirmations).toEqual({ image: 'GENERATE IMAGE', voice: 'GENERATE VOICE', video: 'GENERATE VIDEO' });
  });
  it('hides a kind that is switched off or has no provider key, and everything for a viewer', async () => {
    state.overrides['ai.imagePolicy'] = enabled('image', { enabled: false });
    expect((await aiMediaStatus(actor, { ports: { voice: voicePort() } })).image.available).toBe(false);
    state.secret = null;
    expect((await aiMediaStatus(actor)).voice.available).toBe(false);
    state.secret = 'k'; state.role = 'viewer';
    const viewer = await aiMediaStatus(actor, { ports: { image: imagePort(), voice: voicePort(), video: videoPort() } });
    expect([viewer.image.available, viewer.voice.available, viewer.video.available]).toEqual([false, false, false]);
  });
  it('is off when the workspace opted out of AI', async () => {
    state.workspaceOn = false;
    expect((await aiMediaStatus(actor, { ports: { image: imagePort() } })).image.available).toBe(false);
  });
});

describe('picture generation', () => {
  it('needs the exact confirmation and a known size, and never calls the provider otherwise', async () => {
    const port = imagePort();
    for (const bad of [{ prompt: 'a cat' }, { prompt: 'a cat', confirmation: 'yes' }, { prompt: 'a cat', size: 'giant', confirmation: 'GENERATE IMAGE' }, { prompt: 'ab', confirmation: 'GENERATE IMAGE' }, { prompt: 'a\u0007cat', confirmation: 'GENERATE IMAGE' }, { prompt: 'a cat', confirmation: 'GENERATE IMAGE', extra: 1 }]) {
      await expect(generateImage(actor, bad, { ports: { image: port }, store: store() })).rejects.toMatchObject({ code: 'invalid_request' });
    }
    expect(port.generate).not.toHaveBeenCalled(); expect(state.exec).toEqual([]);
  });
  it('claims the request, creates the picture with the newest model, saves it to the library and audits it', async () => {
    const port = imagePort(); const files = store();
    const result = await generateImage(actor, { prompt: 'a cat on a roof', size: 'portrait', confirmation: 'GENERATE IMAGE' }, { ports: { image: port }, store: files });
    expect(result).toMatchObject({ id: 'img-1', kind: 'image', mimeType: 'image/png', size: png.length });
    expect(port.generate).toHaveBeenCalledWith(expect.objectContaining({ model: 'gpt-image-9', size: '1024x1536', prompt: 'a cat on a roof' }));
    expect(files.putImage).toHaveBeenCalledWith({ userId: 'u1', workspaceId: 'w1' }, expect.any(File));
    const actions = state.exec.map(e => e.sql);
    expect(actions[0]).toContain("'ai.requested'");
    expect(actions.some(a => a.includes("'ai.completed'"))).toBe(true);
    const audit = state.exec.find(e => e.values.includes('ai.image.created'))!;
    expect(audit.values).toContain('w1');
    expect(JSON.stringify(state.exec.map(e => e.values))).not.toContain('a cat on a roof');
  });
  it('records a cost only when a price is configured (unpriced stays unknown, never zero)', async () => {
    await generateImage(actor, { prompt: 'a cat', confirmation: 'GENERATE IMAGE' }, { ports: { image: imagePort() }, store: store() });
    expect(JSON.stringify(state.exec.find(e => e.sql.includes("'ai.completed'"))!.values)).not.toContain('costUsd');
    state.exec = []; state.overrides['ai.imagePolicy'] = enabled('image', { costPerImageUsd: 0.04 });
    await generateImage(actor, { prompt: 'a cat', confirmation: 'GENERATE IMAGE' }, { ports: { image: imagePort() }, store: store() });
    expect(JSON.stringify(state.exec.find(e => e.sql.includes("'ai.completed'"))!.values)).toContain('costUsd\\":0.04');
  });
  it('shares the workspace hourly allowance and monthly budget with AI assist', async () => {
    const port = imagePort(); state.hourlyUsed = 60;
    await expect(generateImage(actor, { prompt: 'a cat', confirmation: 'GENERATE IMAGE' }, { ports: { image: port }, store: store() })).rejects.toMatchObject({ code: 'conflict' });
    expect(port.generate).not.toHaveBeenCalled();
  });
  it('refuses when the library quota would be exceeded and removes nothing it did not store', async () => {
    const files = store(); files.listImages.mockResolvedValue({ items: [], truncated: false, totalFiles: 1, totalBytes: 1_000_000_000 });
    await expect(generateImage(actor, { prompt: 'a cat', confirmation: 'GENERATE IMAGE' }, { ports: { image: imagePort() }, store: files })).rejects.toMatchObject({ code: 'conflict' });
    expect(files.putImage).not.toHaveBeenCalled();
  });
  it('removes the stored file when the audit cannot be recorded', async () => {
    const files = store();
    db.$executeRaw.mockImplementation(async (s: TemplateStringsArray, ...v: unknown[]) => { const q = sql(s, v); state.exec.push(q); return q.values.includes('ai.image.created') ? 0 : 1; });
    await expect(generateImage(actor, { prompt: 'a cat', confirmation: 'GENERATE IMAGE' }, { ports: { image: imagePort() }, store: files })).rejects.toBeTruthy();
    expect(files.removeImage).toHaveBeenCalledWith('w1', 'img-1', true);
  });
  it('never exposes provider text and answers in French when asked', async () => {
    const port = imagePort(); port.generate.mockRejectedValue(new Error('sk-secret provider internals'));
    const error = await generateImage(actor, { prompt: 'a cat', confirmation: 'GENERATE IMAGE' }, { ports: { image: port }, store: store(), locale: 'fr' }).catch((e: unknown) => e as Error);
    expect(error).toMatchObject({ code: 'upstream_failure' });
    const message = (error as Error).message; expect(message).not.toContain('sk-secret'); expect(message).toMatch(/service d’IA/);
  });
});

describe('who may generate', () => {
  it.each(['owner', 'admin', 'editor'])('lets %s write', async value => {
    state.role = value;
    await expect(generateImage(actor, { prompt: 'a cat', confirmation: 'GENERATE IMAGE' }, { ports: { image: imagePort() }, store: store() })).resolves.toMatchObject({ kind: 'image' });
  });
  it('denies a viewer before any provider call or write', async () => {
    state.role = 'viewer'; const port = imagePort();
    await expect(generateImage(actor, { prompt: 'a cat', confirmation: 'GENERATE IMAGE' }, { ports: { image: port }, store: store() })).rejects.toMatchObject({ code: 'forbidden' });
    expect(port.generate).not.toHaveBeenCalled(); expect(state.exec).toEqual([]);
  });
  it('denies a member of another workspace', async () => {
    const port = voicePort();
    await expect(generateVoice({ userId: 'u1', workspaceId: 'foreign' }, { text: 'hello there', confirmation: 'GENERATE VOICE' }, { ports: { voice: port } })).rejects.toMatchObject({ code: 'forbidden' });
    expect(port.speak).not.toHaveBeenCalled();
  });
  it('lets a read-only key ceiling narrow a member who can write', async () => {
    const port = imagePort();
    await expect(generateImage({ ...actor, permissionCeiling: role('viewer') }, { prompt: 'a cat', confirmation: 'GENERATE IMAGE' }, { ports: { image: port }, store: store() })).rejects.toMatchObject({ code: 'forbidden' });
    expect(port.generate).not.toHaveBeenCalled();
  });
});

describe('voice generation', () => {
  it('rejects unknown voices and missing confirmation', async () => {
    const port = voicePort();
    for (const bad of [{ text: 'hello there', voice: 'robot', confirmation: 'GENERATE VOICE' }, { text: 'hello there', confirmation: 'no' }, { text: 'x', confirmation: 'GENERATE VOICE' }]) {
      await expect(generateVoice(actor, bad, { ports: { voice: port } })).rejects.toMatchObject({ code: 'invalid_request' });
    }
    expect(port.speak).not.toHaveBeenCalled();
  });
  it('returns audio without storing anything and audits characters only', async () => {
    const port = voicePort(); const files = store();
    const result = await generateVoice(actor, { text: 'hello there', voice: 'nova', confirmation: 'GENERATE VOICE' }, { ports: { voice: port }, store: files });
    expect(result).toMatchObject({ mimeType: 'audio/mpeg', bytes: 3 }); expect(result.audio.toString()).toBe('mp3');
    expect(port.speak).toHaveBeenCalledWith(expect.objectContaining({ voice: 'nova', model: 'gpt-tts-9', format: 'mp3' }));
    expect(files.putImage).not.toHaveBeenCalled();
    expect(JSON.stringify(state.exec.map(e => e.values))).not.toContain('hello there');
  });
  it('refuses an MCP voice call without the exact confirmation before any provider call', async () => {
    const viewer = { scope: 'workspace', userId: 'u1', workspaceId: 'w1', role: 'owner', workspace: { id: 'w1', name: 'W', timezone: 'UTC' }, entitlements: {} } as never;
    await expect(executeContentTool(viewer, 'generate_ai_voice', { text: 'hello there', confirmation: 'no' })).rejects.toMatchObject({ code: 'invalid_request' });
  });
});

describe('video generation', () => {
  const row = (over: object = {}) => ({ id: 'v1', workspaceId: 'w1', userId: 'u1', prompt: 'waves', operation: 'operations/abc', createdAt: new Date('2026-10-22T00:00:00Z'), ...over });
  const now = () => new Date('2026-10-22T00:05:00Z');
  it('starts a video once the confirmation matches and stores the operation with an audit row', async () => {
    const port = videoPort();
    const result = await startVideo(actor, { prompt: 'waves at dawn', aspectRatio: '9:16', confirmation: 'GENERATE VIDEO' }, { ports: { video: port }, now });
    expect(result.status).toBe('working');
    expect(port.start).toHaveBeenCalledWith(expect.objectContaining({ model: 'veo-9', aspectRatio: '9:16' }));
    const insert = state.exec.find(e => e.sql.includes('INSERT INTO ai_videos'))!;
    expect(insert.values).toContain('w1'); expect(insert.values).toContain('operations/abc');
    expect(state.exec.some(e => e.values.includes('ai.video.started'))).toBe(true);
  });
  it('rejects an unknown format and a viewer', async () => {
    const port = videoPort();
    await expect(startVideo(actor, { prompt: 'waves', aspectRatio: '4:3', confirmation: 'GENERATE VIDEO' }, { ports: { video: port } })).rejects.toMatchObject({ code: 'invalid_request' });
    state.role = 'viewer';
    await expect(startVideo(actor, { prompt: 'waves', confirmation: 'GENERATE VIDEO' }, { ports: { video: port } })).rejects.toMatchObject({ code: 'forbidden' });
    expect(port.start).not.toHaveBeenCalled();
  });
  it('finishes a ready video into the media library exactly once', async () => {
    state.working = [row()]; const files = store(); const port = videoPort({ state: 'done', uri: 'https://generativelanguage.googleapis.com/v1beta/files/x' });
    const result = await listVideos(actor, { ports: { video: port }, store: files, now });
    expect(port.download).toHaveBeenCalledTimes(1); expect(files.putVideo).toHaveBeenCalledTimes(1);
    expect(state.exec.some(e => e.sql.includes('INSERT INTO media') && e.values.includes('w1'))).toBe(true);
    expect(state.exec.some(e => e.sql.includes("status = 'ready'"))).toBe(true);
    expect(result.videos).toBeDefined();
  });
  it('does not store a video another reader already finished', async () => {
    state.working = [row()]; state.videoStatus = 'ready'; const files = store();
    await listVideos(actor, { ports: { video: videoPort({ state: 'done', uri: 'https://generativelanguage.googleapis.com/v1beta/files/x' }) }, store: files, now });
    expect(files.putVideo).not.toHaveBeenCalled();
  });
  it('gives up on a video that takes too long and on a refused description', async () => {
    state.working = [row({ createdAt: new Date('2026-10-20T00:00:00Z') })];
    await listVideos(actor, { ports: { video: videoPort() }, store: store(), now });
    expect(state.exec.some(e => e.sql.includes("status = 'failed'") && e.values.includes('timed_out'))).toBe(true);
    state.exec = []; state.working = [row()];
    await listVideos(actor, { ports: { video: videoPort({ state: 'refused' }) }, store: store(), now });
    expect(state.exec.some(e => e.values.includes('refused'))).toBe(true);
  });
  it('keeps a still-working video and never polls for a viewer-less workspace read', async () => {
    state.working = [row()]; const port = videoPort({ state: 'working' });
    await listVideos(actor, { ports: { video: port }, store: store(), now });
    expect(port.poll).toHaveBeenCalledTimes(1); expect(state.exec).toEqual([]);
  });
  it('lets the worker finish videos of every workspace', async () => {
    state.working = [row(), row({ id: 'v2', workspaceId: 'w2' })];
    const finished = await pollAiVideos({ ports: { video: videoPort({ state: 'done', uri: 'https://generativelanguage.googleapis.com/v1beta/files/x' }) }, store: store(), now });
    expect(finished).toBe(2);
  });
  it('denies listing to another workspace', async () => {
    await expect(listVideos({ userId: 'u1', workspaceId: 'foreign' }, { ports: { video: videoPort() } })).rejects.toMatchObject({ code: 'forbidden' });
  });
});
