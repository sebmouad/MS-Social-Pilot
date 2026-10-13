import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestJson } from '@/lib/client-request';
import { makeWorkflow, runWorkflow } from '@/lib/task-workflow';
afterEach(() => vi.unstubAllGlobals());
describe('browser request outcomes', () => {
  it('preserves API validation and trace detail', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'Invalid', fields: { title: 'Required' }, traceId: 'trace' }), { status: 422 })));
    expect(await requestJson('/api/tasks', { method: 'POST' })).toEqual({ ok: false, kind: 'http', status: 422, error: 'Invalid', fields: { title: 'Required' }, traceId: 'trace' });
  });
  it('reports uncertain transport without retrying mutation', async () => {
    const fetch = vi.fn().mockRejectedValue(new TypeError('offline')); vi.stubGlobal('fetch', fetch);
    expect(await requestJson('/api/tasks', { method: 'POST' })).toMatchObject({ ok: false, kind: 'transport' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('accepts empty success responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    expect(await requestJson('/api/media/id', { method: 'DELETE' })).toEqual({ ok: true, data: undefined });
  });
});
describe('workflow recovery', () => {
  it('rejects overflow rather than truncating', () => {
    expect(() => makeWorkflow(Array(31).fill('task').join('\n'), '', 1, '')).toThrow('rows');
    expect(() => makeWorkflow('x'.repeat(201), '', 1, '')).toThrow('title');
  });
  it('keeps completed, failed and unattempted rows and retries only unresolved', async () => {
    const rows = makeWorkflow('one\ntwo\nthree\nfour\nfive', '2026-10-13', 2, 'member');
    const send = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const partial = await runWorkflow(rows, send);
    expect(partial.map(row => row.state)).toEqual(['created', 'created', 'failed', 'unattempted', 'unattempted']);
    const retry = vi.fn().mockResolvedValue(true);
    expect((await runWorkflow(partial, retry)).every(row => row.state === 'created')).toBe(true);
    expect(retry.mock.calls.map(call => call[0].title)).toEqual(['three', 'four', 'five']);
    expect(retry.mock.calls[0]![0].dueOn).toBe('2026-10-17');
  });
});
it('does not retry uncertain task creates, but can finish unattempted rows', async () => {
  const rows = makeWorkflow('one\ntwo\nthree', '', 1, '');
  const first = await runWorkflow(rows, vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce('uncertain'));
  expect(first.map(row => row.state)).toEqual(['created', 'uncertain', 'unattempted']);
  const retry = vi.fn().mockResolvedValue(true);
  const result = await runWorkflow(first, retry);
  expect(retry).toHaveBeenCalledTimes(1);
  expect(retry.mock.calls[0]![0].title).toBe('three');
  expect(result[1]!.state).toBe('uncertain');
});
