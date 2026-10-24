import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ metadata: vi.fn(), output: vi.fn(), policy: { enabled: true, maxPixels: 20, maxConcurrent: 1, timeoutMs: 100, maxOutputBytes: 100 } }));
vi.mock('sharp', () => ({ default: vi.fn(() => ({ metadata: state.metadata, rotate: () => ({ png: () => ({ toBuffer: state.output }) }) }) ) }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: async () => state.policy }));
import { convertWebp } from '@/modules/media/server/webp';
import { OperationError } from '@/lib/operation-error';
vi.mock('@/modules/media/server/messages', () => ({ mediaError: async (code: ConstructorParameters<typeof OperationError>[0], message: string) => new OperationError(code, message) }));
beforeEach(() => { vi.clearAllMocks(); state.policy = { enabled: true, maxPixels: 20, maxConcurrent: 1, timeoutMs: 100, maxOutputBytes: 100 }; state.metadata.mockResolvedValue({ format: 'webp', width: 2, height: 3, pages: 1 }); state.output.mockResolvedValue(Buffer.from('png')); });
afterEach(() => vi.useRealTimers());
it('honors the Root switch and fails closed on malformed policy', async () => {
  state.policy.enabled = false;
  await expect(convertWebp(Buffer.from('webp'))).rejects.toMatchObject({ code: 'invalid_request' }); expect(state.metadata).not.toHaveBeenCalled();
  state.policy.maxPixels = 0; await expect(convertWebp(Buffer.from('webp'))).rejects.toMatchObject({ code: 'unavailable' });
});
it.each([{ format: 'webp', width: 2, height: 3, pages: 2 }, { format: 'webp', width: 100, height: 100, pages: 1 }, { format: 'jpeg', width: 2, height: 3 }])('refuses animated, oversized or mismatched content: %j', async meta => {
  state.metadata.mockResolvedValue(meta); await expect(convertWebp(Buffer.from('webp'))).rejects.toMatchObject({ code: 'invalid_request' }); expect(state.output).not.toHaveBeenCalled();
});
it('enforces encoded output bytes and redacts native errors', async () => {
  state.output.mockResolvedValueOnce(Buffer.alloc(101)); await expect(convertWebp(Buffer.from('webp'))).rejects.toMatchObject({ code: 'invalid_request' });
  state.metadata.mockRejectedValueOnce(new Error('/private/decoder/path')); await expect(convertWebp(Buffer.from('webp'))).rejects.toThrow('This WebP image could not be imported. Use a still PNG or JPEG image instead.');
});
it('retains its permit after deadline until native work settles', async () => {
  vi.useFakeTimers(); let settle!: (value: Buffer) => void;
  state.output.mockImplementationOnce(() => new Promise<Buffer>(resolve => { settle = resolve; }));
  const first = convertWebp(Buffer.from('webp')); const rejected = expect(first).rejects.toMatchObject({ code: 'invalid_request' });
  await vi.advanceTimersByTimeAsync(101); await rejected;
  await expect(convertWebp(Buffer.from('webp'))).rejects.toMatchObject({ code: 'unavailable' });
  settle(Buffer.from('late png')); await Promise.resolve(); await Promise.resolve();
  await expect(convertWebp(Buffer.from('webp'))).resolves.toEqual(Buffer.from('png'));
});
