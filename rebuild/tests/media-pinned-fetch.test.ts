import { describe, expect, it, vi } from 'vitest';
import { createPinnedFetcher, type PinnedTransport } from '@/modules/publishing/server/media/network/pinned-fetch';

const request = (resolved: string[]) => ({
  url: 'https://example.com/file', headers: {}, signal: new AbortController().signal, resolved,
});
const response = (peerAddress: string): Awaited<ReturnType<PinnedTransport>> => ({
  status: 200, headers: [['content-type', 'image/jpeg']], peerAddress, body: new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array([1, 2, 3])); controller.close(); } }),
});

describe('pinned outbound transport', () => {
  it('requires the connected socket peer to match a validated candidate', async () => {
    const transport = vi.fn(async () => response('93.184.216.35'));
    const fetcher = createPinnedFetcher({ transport });
    await expect(fetcher(request(['93.184.216.34']))).rejects.toThrow();
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('accepts a matching peer including an IPv4-mapped peer representation', async () => {
    const transport = vi.fn(async () => response('::ffff:5db8:d822'));
    const fetcher = createPinnedFetcher({ transport });
    const result = await fetcher(request(['93.184.216.34']));
    expect(result.status).toBe(200);
  });

  it('cancels a mismatched peer response body before trying another candidate', async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } });
    let call = 0;
    const transport: PinnedTransport = async () => ++call === 1
      ? { status: 200, headers: [], peerAddress: '93.184.216.35', body }
      : response('93.184.216.36');
    const fetcher = createPinnedFetcher({ transport });
    const result = await fetcher(request(['93.184.216.34', '93.184.216.36']));
    expect(cancelled).toBe(true);
    expect(result.status).toBe(200);
  });

  it('rejects a non-identity content encoding and cancels its body', async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } });
    const transport: PinnedTransport = async () => ({ status: 200, headers: [['content-encoding', 'gzip']], peerAddress: '93.184.216.34', body });
    const fetcher = createPinnedFetcher({ transport });
    await expect(fetcher(request(['93.184.216.34']))).rejects.toThrow();
    expect(cancelled).toBe(true);
  });
  it('rejects any non-identity value when content-encoding is repeated', async () => {
    const transport: PinnedTransport = async () => ({ status: 200, headers: [['content-encoding', 'identity'], ['content-encoding', 'gzip']], peerAddress: '93.184.216.34', body: null });
    const fetcher = createPinnedFetcher({ transport });
    await expect(fetcher(request(['93.184.216.34']))).rejects.toThrow();
  });
});
