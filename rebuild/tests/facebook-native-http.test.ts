import { createServer, type Server, type RequestListener } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import type { FacebookConfig } from '../src/platforms/facebook/config';
import { createFacebookNativeTransport } from '../src/platforms/facebook/formats/transport';
import { FacebookApiError } from '../src/platforms/facebook/publishing';

const configFor = (graphBaseUrl: string, requestTimeoutMs = 2_000): FacebookConfig => ({
  graphBaseUrl, oauthBaseUrl: 'https://www.facebook.test', graphVersion: 'v99.0', requestTimeoutMs,
  maxPages: 4, pageSize: 25, pageInsightMetrics: [], adInsightFields: [], maxImageUploadBytes: 1024,
  allowedImageMimeTypes: ['image/jpeg'], appSecretProofEnabled: true, appSecret: 'wire-test-app-secret',
});
const policy = { uploadOrigins: ['https://rupload.facebook.test'], maxUploadBytes: 1024, maxResponseBytes: 128 } as const;

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => {
    server.close(() => resolve());
    server.closeAllConnections();
  })));
});

async function listen(handler: RequestListener) {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, 'localhost', resolve);
  });
  const address = server.address() as AddressInfo;
  return { server, baseUrl: `http://localhost:${address.port}` };
}

describe('Facebook native transport over loopback HTTP', () => {
  it('sends signed Graph GET, POST, and DELETE on the wire without contacting a provider', async () => {
    const observed: Array<{ method: string; url: string; body: string }> = [];
    const { baseUrl } = await listen((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', chunk => chunks.push(Buffer.from(chunk)));
      request.on('end', () => {
        observed.push({ method: request.method ?? '', url: request.url ?? '', body: Buffer.concat(chunks).toString('utf8') });
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify(request.method === 'DELETE' ? { success: true } : { id: 'local-object', success: true }));
      });
    });
    const token = 'synthetic+token/with=reserved';
    const transport = createFacebookNativeTransport(configFor(baseUrl), token, policy);

    await expect(transport.getGraph('page_1/videos', ['id', 'status'])).resolves.toEqual({ id: 'local-object', success: true });
    await expect(transport.postGraph('page_1/videos', { description: 'hello from local test' })).resolves.toEqual({ id: 'local-object', success: true });
    await expect(transport.deleteGraph('page_1/videos/video_1')).resolves.toEqual({ success: true });

    const proof = createHmac('sha256', 'wire-test-app-secret').update(token).digest('hex');
    expect(observed).toHaveLength(3);
    expect(observed.map(item => item.method)).toEqual(['GET', 'POST', 'DELETE']);
    const getUrl = new URL(observed[0]!.url, baseUrl);
    expect(getUrl.pathname).toBe('/v99.0/page_1/videos');
    expect(getUrl.searchParams.get('fields')).toBe('id,status');
    expect(getUrl.searchParams.get('access_token')).toBe(token);
    expect(getUrl.searchParams.get('appsecret_proof')).toBe(proof);

    const postUrl = new URL(observed[1]!.url, baseUrl);
    const postBody = new URLSearchParams(observed[1]!.body);
    expect(postUrl.pathname).toBe('/v99.0/page_1/videos');
    expect(postBody.get('description')).toBe('hello from local test');
    expect(postBody.get('access_token')).toBe(token);
    expect(postBody.get('appsecret_proof')).toBe(proof);

    const deleteUrl = new URL(observed[2]!.url, baseUrl);
    expect(deleteUrl.pathname).toBe('/v99.0/page_1/videos/video_1');
    expect(deleteUrl.searchParams.get('access_token')).toBe(token);
    expect(deleteUrl.searchParams.get('appsecret_proof')).toBe(proof);
    expect(observed.map(item => `${item.url} ${item.body}`).join('\n')).not.toContain('wire-test-app-secret');
  });

  it('refuses an oversized streamed body after one request and returns only a safe error', async () => {
    let requests = 0;
    const { baseUrl } = await listen((_request, response) => {
      requests += 1;
      response.writeHead(200, { 'content-type': 'application/json' });
      response.write('{"data":"');
      response.end('x'.repeat(512) + '"}');
    });
    const transport = createFacebookNativeTransport(configFor(baseUrl), 'synthetic-token', { ...policy, maxResponseBytes: 32 });

    const failure = await transport.getGraph('page_1', []).catch(error => error);
    expect(failure).toBeInstanceOf(FacebookApiError);
    expect(failure).toMatchObject({ message: 'Facebook request failed.', status: 200 });
    expect(String(failure)).not.toContain('synthetic-token');
    expect(requests).toBe(1);
  });

  it('cancels a stalled read body without poisoning subsequent requests', async () => {
    let requests = 0;
    let observed!: () => void;
    const arrived = new Promise<void>(resolve => { observed = resolve; });
    const { baseUrl } = await listen((_request, response) => {
      requests += 1;
      response.writeHead(200, { 'content-type': 'application/json' });
      if (requests === 1) {
        response.write('{"partial":');
        observed();
      } else response.end(JSON.stringify({ id: 'local-object' }));
    });
    const transport = createFacebookNativeTransport(configFor(baseUrl), 'synthetic-token', policy);
    const controller = new AbortController();
    const pending = transport.getGraph('page_1', ['id'], controller.signal).catch(error => error);
    await arrived;
    controller.abort();
    const failure = await pending;
    expect(failure).toBeInstanceOf(FacebookApiError);
    expect(failure).toMatchObject({ message: 'Facebook request failed.' });
    await expect(transport.getGraph('page_1', ['id'])).resolves.toEqual({ id: 'local-object' });
    expect(requests).toBe(2);
  });

  it('aborts a stalled response body at the configured request timeout without retrying', async () => {
    let requests = 0;
    const { baseUrl } = await listen((_request, response) => {
      requests += 1;
      response.writeHead(200, { 'content-type': 'application/json' });
      response.write('{"partial":');
      // Leave the body open. Fetch must stop reading when requestTimeoutMs expires.
    });
    const transport = createFacebookNativeTransport(configFor(baseUrl, 1_000), 'synthetic-token', policy);

    const started = Date.now();
    const failure = await transport.getGraph('page_1', []).catch(error => error);
    const elapsed = Date.now() - started;
    expect(failure).toBeInstanceOf(FacebookApiError);
    expect(failure).toMatchObject({ message: 'Facebook request failed.' });
    expect([0,200]).toContain(failure.status);
    expect(String(failure)).not.toContain('synthetic-token');
    expect(elapsed).toBeLessThan(4_000);
    expect(requests).toBe(1);
  });
});
