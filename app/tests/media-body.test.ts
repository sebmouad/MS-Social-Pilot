import { describe, expect, it, vi } from 'vitest';
import { MediaBodyTooLarge, readBoundedImageForm } from '@/modules/publishing/server/media/body';

describe('bounded image multipart parsing', () => {
  it('parses a valid form within its complete envelope limit', async () => {
    const form = new FormData();
    form.set('imageFile', new File([new Uint8Array([137, 80, 78, 71])], 'test.png', { type: 'image/png' }));
    const request = new Request('http://localhost/api/media', { method: 'POST', body: form });
    const parsed = await readBoundedImageForm(request, 4096);
    expect((parsed.get('imageFile') as File).name).toBe('test.png');
  });

  it('rejects an oversized stream even without a Content-Length header', async () => {
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(8)); controller.enqueue(new Uint8Array(8)); controller.close(); } });
    const request = new Request('http://localhost/api/media', { method: 'POST', headers: { 'content-type': 'multipart/form-data; boundary=test' }, body, duplex: 'half' } as RequestInit & { duplex: 'half' });
    await expect(readBoundedImageForm(request, 12)).rejects.toBeInstanceOf(MediaBodyTooLarge);
  });

  it('rejects a declared oversized body before reading it', async () => {
    const request = new Request('http://localhost/api/media', { method: 'POST', headers: { 'content-type': 'multipart/form-data; boundary=test', 'content-length': '999' }, body: 'small' });
    await expect(readBoundedImageForm(request, 12)).rejects.toBeInstanceOf(MediaBodyTooLarge);
  });
});

// Error copy is supplied by Root at runtime; this isolated test uses its validated defaults.
vi.mock('../src/modules/publishing/server/error-copy', async () => {
  const { defaultPublishingErrorText } = await import('../src/modules/publishing/error-catalog');
  return { loadPublishingErrorText: async () => defaultPublishingErrorText };
});
