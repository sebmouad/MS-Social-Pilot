import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  runtimeConfigBatch: vi.fn(),
  guardedFetch: vi.fn(),
  inspectMediaSnapshot: vi.fn(),
  lookup: vi.fn(),
  pinnedFetcher: vi.fn(),
}));

vi.mock('../src/server/config/store', () => ({ runtimeConfigBatch: mocks.runtimeConfigBatch }));
vi.mock('@/modules/publishing/server/media/network/net-guard', () => ({ guardedFetch: mocks.guardedFetch }));
vi.mock('@/modules/publishing/server/media/network/pinned-fetch', () => ({ pinnedFetcher: mocks.pinnedFetcher }));
vi.mock('@/modules/publishing/server/media/inspect', () => ({ inspectMediaSnapshot: mocks.inspectMediaSnapshot }));
vi.mock('node:dns/promises', () => ({ lookup: mocks.lookup }));

import { MEDIA_INSPECTION_CONFIG } from '@/modules/publishing/server/media/inspection-config';
import { resolveRemoteMediaSnapshot, RemoteMediaSnapshotError } from '@/modules/publishing/server/media/resolve-remote';

const entries = Object.fromEntries(MEDIA_INSPECTION_CONFIG.map(entry => [entry.key, entry.defaultValue]));
const sourceBytes = Buffer.from('fetched source bytes');
const inspected = {
  bytes: Buffer.from(sourceBytes), sha256: 'verified-digest', mimeType: 'video/mp4', sizeBytes: sourceBytes.length,
  width: 720, height: 1280, durationSeconds: 12.5,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.runtimeConfigBatch.mockResolvedValue({
    ...entries,
    'media.inspectMaxBytes': 123456,
    'media.inspectFetchTimeoutMs': 6789,
    'media.inspectMaxRedirects': 2,
    'media.inspectAllowHttp': false,
    'media.inspectHostAllowlist': ['cdn.example.test'],
  });
  mocks.guardedFetch.mockResolvedValue({ notModified: false, finalUrl: 'https://cdn.example.test/video.mp4', status: 200, bytes: sourceBytes, contentType: 'application/octet-stream', etag: null, lastModified: null });
  mocks.inspectMediaSnapshot.mockResolvedValue(inspected);
  mocks.lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
  mocks.pinnedFetcher.mockResolvedValue(new Response(sourceBytes));
});

describe('resolveRemoteMediaSnapshot', () => {
  it('uses registered inspection settings to bound the address-pinned fetch', async () => {
    await resolveRemoteMediaSnapshot('https://cdn.example.test/video.mp4', 'video');

    expect(mocks.runtimeConfigBatch).toHaveBeenCalledWith([
      'media.inspectMaxBytes', 'media.inspectFetchTimeoutMs', 'media.inspectMaxRedirects',
      'media.inspectAllowHttp', 'media.inspectHostAllowlist',
    ]);
    expect(mocks.guardedFetch.mock.calls[0]?.[1]).toEqual({
      maxBytes: 123456, timeoutMs: 6789, maxRedirects: 2, allowHttp: false,
      hostAllowlist: ['cdn.example.test'],
    });
    const deps = mocks.guardedFetch.mock.calls[0]?.[2];
    await deps.resolve('cdn.example.test');
    expect(mocks.lookup).toHaveBeenCalledWith('cdn.example.test', { all: true, verbatim: true });
    await deps.fetcher({ url: 'https://cdn.example.test/video.mp4', headers: {}, signal: new AbortController().signal, resolved: ['93.184.216.34'] });
    expect(mocks.pinnedFetcher).toHaveBeenCalledOnce();
  });

  it('rejects values outside the registered setting schemas before fetching', async () => {
    mocks.runtimeConfigBatch.mockResolvedValue({ ...entries, 'media.inspectMaxBytes': 0 });

    await expect(resolveRemoteMediaSnapshot('https://cdn.example.test/video.mp4', 'video')).rejects.toBeInstanceOf(RemoteMediaSnapshotError);
    expect(mocks.guardedFetch).not.toHaveBeenCalled();
  });

  it('inspects exactly the fetched bytes and returns a frozen trusted snapshot', async () => {
    const controller = new AbortController();
    const result = await resolveRemoteMediaSnapshot('https://cdn.example.test/video.mp4', 'video', { signal: controller.signal });

    expect(mocks.inspectMediaSnapshot).toHaveBeenCalledWith(sourceBytes, 'video', { signal: controller.signal });
    expect(result).toMatchObject({ sha256: 'verified-digest', mimeType: 'video/mp4', sizeBytes: sourceBytes.length, width: 720, height: 1280, durationSeconds: 12.5 });
    expect(Object.isFrozen(result)).toBe(true);
    expect(result).not.toHaveProperty('finalUrl');
    expect(result.bytes).not.toBe(inspected.bytes);
    result.bytes[0] = 0;
    expect(result.bytes).toEqual(sourceBytes);
  });

  it('propagates cancellation into fetch and inspection, and refuses an already-aborted request', async () => {
    const controller = new AbortController();
    await resolveRemoteMediaSnapshot('https://cdn.example.test/video.mp4', 'video', { signal: controller.signal });
    expect(mocks.guardedFetch.mock.calls[0]?.[3]).toEqual({ signal: controller.signal });
    expect(mocks.inspectMediaSnapshot.mock.calls[0]?.[2]).toEqual({ signal: controller.signal });

    vi.clearAllMocks();
    controller.abort();
    await expect(resolveRemoteMediaSnapshot('https://cdn.example.test/video.mp4', 'video', { signal: controller.signal })).rejects.toBeInstanceOf(RemoteMediaSnapshotError);
    expect(mocks.runtimeConfigBatch).not.toHaveBeenCalled();
    expect(mocks.guardedFetch).not.toHaveBeenCalled();
  });

  it('refuses not-modified results and hides URL or transport details from failures', async () => {
    mocks.guardedFetch.mockResolvedValue({ notModified: true, finalUrl: 'https://user:secret@private.example/video.mp4' });
    await expect(resolveRemoteMediaSnapshot('https://user:secret@private.example/video.mp4', 'video')).rejects.toThrow(RemoteMediaSnapshotError);
    expect(mocks.inspectMediaSnapshot).not.toHaveBeenCalled();

    mocks.guardedFetch.mockRejectedValue(new Error('request to https://user:secret@private.example failed: ECONNRESET'));
    const error = await resolveRemoteMediaSnapshot('https://user:secret@private.example/video.mp4', 'video').catch(value => value);
    expect(error).toBeInstanceOf(RemoteMediaSnapshotError);
    expect(error.message).not.toMatch(/secret|private\.example|ECONNRESET/);
  });
});
