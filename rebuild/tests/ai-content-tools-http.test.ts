import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  viewer: vi.fn(), image: vi.fn(), voice: vi.fn(), status: vi.fn(), videos: vi.fn(), start: vi.fn(), preview: vi.fn(), outlook: vi.fn(), spam: vi.fn(),
  list: vi.fn(), testable: vi.fn(), startTest: vi.fn(), learn: vi.fn(),
}));
vi.mock('@/server/context', () => ({ requireViewer: mocks.viewer }));
vi.mock('@/server/request-origin', () => ({ requestOrigin: () => 'https://app.example.com' }));
vi.mock('@/server/config/config-or-default', async () => {
  const { TOOLS_COPY } = await import('../src/modules/ai/content-tools/copy');
  const { CAPTION_TESTS_COPY } = await import('../src/modules/caption-tests/copy');
  return { configOrDefault: async (key: string) => key === 'ai.toolsCopy' ? TOOLS_COPY : CAPTION_TESTS_COPY };
});
vi.mock('../src/modules/ai/content-tools/server/media', () => ({ aiMediaStatus: mocks.status, generateImage: mocks.image, generateVoice: mocks.voice, listVideos: mocks.videos, startVideo: mocks.start }));
vi.mock('../src/modules/ai/content-tools/server/checks', () => ({ linkPreview: mocks.preview, engagementOutlook: mocks.outlook, spamCheck: mocks.spam }));
vi.mock('../src/modules/caption-tests/server/service', () => ({ listCaptionTests: mocks.list, listTestablePosts: mocks.testable, startCaptionTest: mocks.startTest, learnCaptionTest: mocks.learn }));

import { aiImageHttp, aiMediaStatusHttp, aiVideoHttp, aiVoiceHttp, linkPreviewHttp, outlookHttp, spamCheckHttp } from '../src/modules/ai/content-tools/server/http';
import { captionTestLearnHttp, captionTestsListHttp, captionTestsStartHttp } from '../src/modules/caption-tests/server/http';

const post = (url: string, body: unknown, headers: Record<string, string> = {}) => new Request(`https://app.example.com${url}`, { method: 'POST', headers: { origin: 'https://app.example.com', 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.viewer.mockResolvedValue({ user: { id: 'u1' }, workspaceId: 'w1' });
});

describe('AI media REST entry points', () => {
  it('passes the signed-in member, parsed body and request language to the shared service', async () => {
    mocks.image.mockResolvedValue({ id: 'img-1', kind: 'image' });
    const response = await aiImageHttp(post('/api/ai/image', { prompt: 'cat', confirmation: 'GENERATE IMAGE' }, { 'accept-language': 'fr-FR,fr' }));
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ id: 'img-1', kind: 'image' });
    expect(mocks.image).toHaveBeenCalledWith({ userId: 'u1', workspaceId: 'w1' }, { prompt: 'cat', confirmation: 'GENERATE IMAGE' }, { locale: 'fr' });
    expect(mocks.viewer).toHaveBeenCalledWith(expect.objectContaining({ feature: 'publishing/posts', write: true, channelScoped: true }));
  });
  it('refuses cross-origin and origin-less writes before authentication or any work', async () => {
    for (const headers of [{ origin: 'https://evil.example.net' }, { origin: '' }]) {
      const response = await aiImageHttp(post('/api/ai/image', {}, headers));
      expect(response.status).toBe(403);
    }
    expect(mocks.viewer).not.toHaveBeenCalled(); expect(mocks.image).not.toHaveBeenCalled();
  });
  it('answers 401 when there is no session and hides unexpected errors behind a generic 502', async () => {
    mocks.viewer.mockRejectedValue(Object.assign(new Error('NEXT_REDIRECT'), { digest: 'NEXT_REDIRECT;replace;/sign-in;307;' }));
    expect((await aiImageHttp(post('/api/ai/image', {}))).status).toBe(401);
    mocks.viewer.mockResolvedValue({ user: { id: 'u1' }, workspaceId: 'w1' });
    mocks.image.mockRejectedValue(Object.assign(new Error('boom sk-secret'), { name: 'OperationError', code: 'forbidden' }));
    const denied = await aiImageHttp(post('/api/ai/image', {}));
    expect(denied.status).toBe(502); expect(JSON.stringify(await denied.json())).not.toContain('sk-secret');
  });
  it('rejects unreadable and oversized bodies', async () => {
    expect((await aiImageHttp(new Request('https://app.example.com/api/ai/image', { method: 'POST', headers: { origin: 'https://app.example.com' }, body: '{nope' }))).status).toBe(400);
    expect((await aiImageHttp(post('/api/ai/image', { prompt: 'x'.repeat(250_000) }))).status).toBe(400);
    expect(mocks.image).not.toHaveBeenCalled();
  });
  it('returns voice audio as bytes and video as list on GET / start on POST', async () => {
    mocks.voice.mockResolvedValue({ audio: Buffer.from('abc'), mimeType: 'audio/mpeg', bytes: 3 });
    const audio = await aiVoiceHttp(post('/api/ai/voice', { text: 'hello', confirmation: 'GENERATE VOICE' }));
    expect(audio.headers.get('content-type')).toBe('audio/mpeg'); expect(Buffer.from(await audio.arrayBuffer()).toString()).toBe('abc');
    mocks.videos.mockResolvedValue({ videos: [] }); mocks.start.mockResolvedValue({ id: 'v1', status: 'working' });
    expect(await (await aiVideoHttp(new Request('https://app.example.com/api/ai/video'))).json()).toEqual({ videos: [] });
    expect(mocks.viewer).toHaveBeenLastCalledWith(expect.not.objectContaining({ write: true }));
    expect((await aiVideoHttp(post('/api/ai/video', { prompt: 'waves', confirmation: 'GENERATE VIDEO' }))).status).toBe(200);
    expect(mocks.start).toHaveBeenCalledTimes(1);
  });
  it('serves status without needing a same-origin header', async () => {
    mocks.status.mockResolvedValue({ image: { available: false } });
    expect((await aiMediaStatusHttp(new Request('https://app.example.com/api/ai/media'))).status).toBe(200);
  });
  it('routes the composer checks to their services', async () => {
    mocks.preview.mockResolvedValue({ preview: null }); mocks.outlook.mockResolvedValue({ outlook: 'unknown' }); mocks.spam.mockResolvedValue({ risk: null, gapMinutes: 20 });
    await linkPreviewHttp(post('/api/publishing/link-preview', { url: 'https://example.com' }));
    await outlookHttp(post('/api/publishing/outlook', { targetId: 't1' }));
    await spamCheckHttp(post('/api/publishing/spam-check', { targetIds: ['t1'] }));
    expect(mocks.preview).toHaveBeenCalledWith({ userId: 'u1', workspaceId: 'w1' }, { url: 'https://example.com' }, { locale: 'en' });
    expect(mocks.outlook).toHaveBeenCalledTimes(1); expect(mocks.spam).toHaveBeenCalledTimes(1);
  });
});

describe('caption test REST entry points', () => {
  it('lists tests, or testable posts with view=posts, using read access to Analytics posts', async () => {
    mocks.list.mockResolvedValue({ tests: [] }); mocks.testable.mockResolvedValue([{ id: 'p' }]);
    expect(await (await captionTestsListHttp(new Request('https://app.example.com/api/caption-tests'))).json()).toEqual({ tests: [] });
    expect(await (await captionTestsListHttp(new Request('https://app.example.com/api/caption-tests?view=posts'))).json()).toEqual({ posts: [{ id: 'p' }] });
    expect(mocks.viewer).toHaveBeenCalledWith(expect.objectContaining({ feature: 'analytics/posts' }));
  });
  it('starts a test from a same-origin write only', async () => {
    mocks.startTest.mockResolvedValue({ id: 't1', ok: true });
    expect((await captionTestsStartHttp(post('/api/caption-tests', { postIds: ['a', 'b'], confirmation: 'START CAPTION TEST' }, { origin: 'https://evil.example.net' }))).status).toBe(403);
    expect((await captionTestsStartHttp(post('/api/caption-tests', { postIds: ['a', 'b'], confirmation: 'START CAPTION TEST' }))).status).toBe(200);
    expect(mocks.startTest).toHaveBeenCalledTimes(1);
  });
  it('takes the test id from the route, never from the body, and gates on workspace settings', async () => {
    mocks.learn.mockResolvedValue({ saved: true, already: false });
    await captionTestLearnHttp(post('/api/caption-tests/t1/learn', { id: 'forged', confirmation: 'LEARN t1' }), { params: Promise.resolve({ id: 't1' }) });
    expect(mocks.learn).toHaveBeenCalledWith({ userId: 'u1', workspaceId: 'w1' }, { id: 't1', confirmation: 'LEARN t1' }, { locale: 'en' });
    expect(mocks.viewer).toHaveBeenCalledWith(expect.objectContaining({ feature: 'settings/workspace', module: 'settings' }));
  });
});
