import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ viewer: vi.fn(), config: vi.fn(), secret: vi.fn(), read: vi.fn(), upload: vi.fn() }));
vi.mock('../src/server/context', () => ({ requireViewer: mocks.viewer }));
vi.mock('../src/server/config/store', () => ({ runtimeConfig: mocks.config, runtimeSecret: mocks.secret }));
vi.mock('@/modules/publishing/server/media/storage', () => ({ readWorkspaceImage: mocks.read, uploadWorkspaceImage: mocks.upload }));
vi.mock('../src/server/data-control/guard', () => ({ withWorkspaceOperation: (_id: string, run: () => Promise<unknown>) => run() }));

import { GET } from '../src/app/api/media/[id]/route';
import { POST } from '../src/app/api/media/route';
import { signMediaShare } from '@/modules/publishing/server/media/signed-urls';

const SECRET = 'test-share-secret';
const WORKSPACE = 'workspace-a';
const ID = '123e4567-e89b-42d3-a456-426614174000';
const BYTES = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function signedRequest(id: string, grant: { workspaceId: string; exp: number; sig: string }) {
  const query = new URLSearchParams({ ws: grant.workspaceId, exp: String(grant.exp), sig: grant.sig });
  return new Request(`http://localhost/api/media/${id}?${query.toString()}`);
}
function grantFor(workspaceId: string, id: string, lifetimeSeconds = 3600) {
  const exp = Math.floor(Date.now() / 1000) + lifetimeSeconds;
  return { workspaceId, exp, sig: signMediaShare({ workspaceId, id, exp }, SECRET) };
}
function uploadRequest() {
  const form = new FormData();
  form.set('imageFile', new File([BYTES], 'test.png', { type: 'image/png' }));
  return new Request('http://localhost/api/media', { method: 'POST', headers: { origin: 'http://localhost' }, body: form });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.viewer.mockResolvedValue({ user: { id: 'user-a' }, workspaceId: WORKSPACE });
  mocks.config.mockImplementation(async (key: string) => key === 'publishing.maxImageUploadBytes' ? 1024 : key === 'publishing.maxImageUploadRequestOverheadBytes' ? 1024 : key === 'publishing.mediaShareExpirySeconds' ? 3600 : key === 'app.publicOrigin' ? 'https://app.test' : undefined);
  mocks.secret.mockResolvedValue(SECRET);
  mocks.read.mockResolvedValue({ id: ID, mimeType: 'image/png', fileName: ID, bytes: BYTES });
  mocks.upload.mockResolvedValue({ id: ID, mimeType: 'image/png', fileName: 'test.png' });
});

describe('signed media serving', () => {
  it('serves one stored image for a valid grant without a session', async () => {
    mocks.viewer.mockRejectedValue(new Error('no session'));
    const response = await GET(signedRequest(ID, grantFor(WORKSPACE, ID)), { params: Promise.resolve({ id: ID }) });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(mocks.read).toHaveBeenCalledWith(WORKSPACE, ID);
    expect(mocks.viewer).not.toHaveBeenCalled();
  });

  it.each([
    ['tampered signature', (grant: { workspaceId: string; exp: number; sig: string }) => ({ ...grant, sig: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' })],
    ['expired grant', (grant: { workspaceId: string; exp: number; sig: string }) => ({ ...grant, exp: Math.floor(Date.now() / 1000) - 1 })],
    ['swapped workspace', (grant: { workspaceId: string; exp: number; sig: string }) => ({ ...grant, workspaceId: 'workspace-b' })],
  ])('answers 404 for a %s without reading storage', async (_name, tamper) => {
    mocks.viewer.mockRejectedValue(new Error('no session'));
    const response = await GET(signedRequest(ID, tamper(grantFor(WORKSPACE, ID))), { params: Promise.resolve({ id: ID }) });
    expect(response.status).toBe(404);
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it('answers 404 when the path id differs from the signed id', async () => {
    mocks.viewer.mockRejectedValue(new Error('no session'));
    const other = '123e4567-e89b-42d3-a456-426614174001';
    const response = await GET(signedRequest(other, grantFor(WORKSPACE, ID)), { params: Promise.resolve({ id: other }) });
    expect(response.status).toBe(404);
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it('answers 404 for a partial grant instead of falling back to the session', async () => {
    const response = await GET(new Request(`http://localhost/api/media/${ID}?ws=${WORKSPACE}`), { params: Promise.resolve({ id: ID }) });
    expect(response.status).toBe(404);
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.viewer).not.toHaveBeenCalled();
  });

  it('keeps the session path unchanged without signed query', async () => {
    const response = await GET(new Request(`http://localhost/api/media/${ID}`), { params: Promise.resolve({ id: ID }) });
    expect(response.status).toBe(200);
    expect(mocks.read).toHaveBeenCalledWith(WORKSPACE, ID);
    mocks.viewer.mockRejectedValueOnce(new Error('no session')).mockRejectedValueOnce(new Error('no session'));
    const denied = await GET(new Request(`http://localhost/api/media/${ID}`), { params: Promise.resolve({ id: ID }) });
    expect(denied.status).toBe(401);
  });
});

describe('signed upload receipts', () => {
  it('includes a verifiable signed preview URL while the pipeline is configured', async () => {
    const response = await POST(uploadRequest());
    expect(response.status).toBe(200);
    const body = await response.json() as { reference: string; url: string; signedUrl?: string };
    expect(body.reference).toBe(`media:${ID}`);
    expect(body.url).toBe(`/api/media/${ID}`);
    expect(body.signedUrl?.startsWith(`/api/media/${ID}?ws=${WORKSPACE}&`)).toBe(true);
  });

  it('omits the signed URL while no secret is configured', async () => {
    mocks.secret.mockResolvedValue(null);
    const response = await POST(uploadRequest());
    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown>;
    expect(body.reference).toBe(`media:${ID}`);
    expect('signedUrl' in body).toBe(false);
  });
});
