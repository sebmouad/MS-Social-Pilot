import { describe, expect, it, vi } from 'vitest';
import { readBoundedJson, RequestBodyTooLarge } from '@/server/http/body';
const request = (body: string, headers: Record<string, string> = {}) => new Request('http://localhost/action', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body });
describe('Bounded public JSON input', () => {
  it('accepts the exact UTF-8 byte boundary, including multibyte text', async () => {
    const body = JSON.stringify({ comment: 'é' });
    expect(await readBoundedJson(request(body), Buffer.byteLength(body))).toEqual({ comment: 'é' });
    await expect(readBoundedJson(request(body), Buffer.byteLength(body) - 1)).rejects.toBeInstanceOf(RequestBodyTooLarge);
  });
  it('cancels oversized streaming input even with a forged short declared length', async () => {
    const cancel = vi.fn(); let sent = 0;
    const stream = new ReadableStream<Uint8Array>({ pull(controller) { if (++sent === 1) controller.enqueue(new TextEncoder().encode('{"x":"')); else if (sent === 2) controller.enqueue(new Uint8Array(40)); else controller.enqueue(new Uint8Array(40)); }, cancel });
    const input = new Request('http://localhost/action', { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': '1' }, body: stream, duplex: 'half' } as RequestInit);
    await expect(readBoundedJson(input, 10)).rejects.toBeInstanceOf(RequestBodyTooLarge);
    expect(cancel).toHaveBeenCalledOnce();
  });
  it('refuses a declared oversized body before consuming it', async () => {
    const input = request('{}', { 'content-length': '1000' });
    await expect(readBoundedJson(input, 10)).rejects.toBeInstanceOf(RequestBodyTooLarge);
    expect(input.bodyUsed).toBe(true);
  });
  it('fails closed on invalid policy and malformed input without echoing content', async () => {
    await expect(readBoundedJson(request('{}'), 0)).rejects.toMatchObject({ code: 'unavailable' });
    await expect(readBoundedJson(request('private invalid json'), 100)).rejects.toMatchObject({ code: 'invalid_request', message: 'Enter valid details and try again.' });
    await expect(readBoundedJson(request('{}', { 'content-type': 'text/plain' }), 100)).rejects.toMatchObject({ code: 'invalid_request' });
  });
});
