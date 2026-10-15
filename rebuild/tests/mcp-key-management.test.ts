import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  $queryRaw: vi.fn(), $executeRaw: vi.fn(), $transaction: vi.fn(),
}));
const viewer = vi.hoisted(() => ({
  user: { id: 'owner-1' }, workspaceId: 'workspace-1', membership: { role: 'owner' },
  entitlements: { features: { 'publishing/posts': true } },
  permissions: { features: { 'publishing/posts': { read: true, write: true } } },
}));
vi.mock('../src/server/data', () => ({ prisma: db }));
vi.mock('../src/server/context', () => ({ requireViewer: vi.fn(async () => viewer) }));
vi.mock('../src/server/config/store', () => ({ runtimeConfig: vi.fn(async (key: string) => key.endsWith('maxActivePerWorkspace') ? 5 : 90) }));

import { POST, DELETE } from '../src/app/api/settings/mcp-keys/route';

const sameOriginHeaders = { origin: 'http://localhost', 'content-type': 'application/json' };
const tx = { $queryRaw: vi.fn(), $executeRaw: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();
  db.$transaction.mockImplementation(async (callback: (client: typeof tx) => unknown) => callback(tx));
  tx.$queryRaw.mockImplementation(async (query: TemplateStringsArray) => query.join('').includes('COUNT(*)') ? [{ count: BigInt(0) }] : []);
  tx.$executeRaw.mockResolvedValue(1);
  db.$executeRaw.mockResolvedValue(1);
});

describe('MCP key management', () => {
  it('issues a single-display token while persisting only a hash and auditing scopes', async () => {
    const response = await POST(new Request('http://localhost/api/settings/mcp-keys', { method: 'POST', headers: sameOriginHeaders, body: JSON.stringify({ name: 'CI reader', readFeatures: ['publishing/posts'], writeFeatures: [], expiresInDays: 30 }) }));
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.token).toMatch(/^mcp_[A-Za-z0-9_-]{43}$/);
    expect(body.key.tokenPrefix).toBe(body.token.slice(0, 12));
    const inserts = tx.$executeRaw.mock.calls;
    expect(inserts).toHaveLength(2);
    const boundValues = inserts.flatMap(call => call.slice(1));
    expect(boundValues).not.toContain(body.token);
    expect(inserts[0][0].join('')).toContain('INSERT INTO mcp_api_keys');
    expect(inserts[1][0].join('')).toContain('mcp.key_created');
  });

  it('rejects cross-origin creation and scopes beyond current UI permissions', async () => {
    const crossOrigin = await POST(new Request('http://localhost/api/settings/mcp-keys', { method: 'POST', headers: { ...sameOriginHeaders, origin: 'https://evil.example' }, body: '{}' }));
    expect(crossOrigin.status).toBe(403);
    const denied = await POST(new Request('http://localhost/api/settings/mcp-keys', { method: 'POST', headers: sameOriginHeaders, body: JSON.stringify({ name: 'Too broad', readFeatures: ['ads/campaigns'], writeFeatures: [], expiresInDays: 30 }) }));
    expect(denied.status).toBe(403);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('revokes only an active key in the current workspace and audits the action', async () => {
    const response = await DELETE(new Request('http://localhost/api/settings/mcp-keys', { method: 'DELETE', headers: sameOriginHeaders, body: JSON.stringify({ id: 'key-1' }) }));
    expect(response.status).toBe(200);
    expect(db.$executeRaw.mock.calls[0][0].join('')).toContain('"workspaceId"');
    expect(db.$executeRaw.mock.calls[1].slice(1)).toContain('mcp.key_revoked');
  });
});
