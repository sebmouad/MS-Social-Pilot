// Insight series pagination (2026-11-24): Graph's « next » for a day series can point at the windows after the one asked
// for, endlessly; page_follows over a 60-day history block hit the page limit and the whole block failed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFacebookDataCollector } from '@/platforms/facebook/data-collection';

const config = { graphBaseUrl: 'https://graph.example', oauthBaseUrl: 'https://www.example', graphVersion: 'v27.0', requestTimeoutMs: 1000, maxPages: 3, pageSize: 25,
  pageInsightMetrics: ['page_follows'], adInsightFields: [], maxImageUploadBytes: 1_000_000, allowedImageMimeTypes: ['image/jpeg'], appSecretProofEnabled: false };

function graph(inRange: number) {
  const calls: string[] = [];
  const fetchImpl = (async (input: URL | string) => {
    const url = new URL(String(input)); calls.push(url.toString());
    const since = Number(url.searchParams.get('since')), until = Number(url.searchParams.get('until'));
    const page = calls.length;
    // The first `inRange` pages stay inside the asked window; after that, each « next » is the following window.
    const nextSince = page < inRange ? since + 86_400 : until;
    const next = new URL(url); next.searchParams.set('since', String(nextSince)); next.searchParams.set('until', String(nextSince + (until - since)));
    const value = { name: 'page_follows', period: 'day', values: [{ value: 100 + page, end_time: new Date((since + 86_400) * 1000).toISOString() }] };
    return new Response(JSON.stringify({ data: [value], paging: { next: next.toString() } }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

test('facebook insights: a « next » link past the asked window ends the read instead of failing at the page limit', async () => {
  const g = graph(1);
  const collector = createFacebookDataCollector(config, { periods: ['day'], content: [] }, g.fetchImpl);
  const since = new Date('2026-09-01T00:00:00Z'), until = new Date('2026-10-31T00:00:00Z');
  const out = await collector.getPageInsightObservations('token', '123', since, until);
  assert.equal(g.calls.length, 1, 'stops after the first page: its next starts at until');
  assert.ok(out.some(row => row.metric === 'page_follows' && row.numeric === 101));
  assert.ok(!out.failedMetrics?.length);
});

test('facebook insights: « next » links still inside the window are followed', async () => {
  const g = graph(2);
  const collector = createFacebookDataCollector(config, { periods: ['day'], content: [] }, g.fetchImpl);
  await collector.getPageInsightObservations('token', '123', new Date('2026-09-01T00:00:00Z'), new Date('2026-10-31T00:00:00Z'));
  assert.equal(g.calls.length, 2);
});
