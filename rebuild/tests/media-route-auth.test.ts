import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ viewer: vi.fn(), config: vi.fn(), upload: vi.fn(), read: vi.fn() }));
vi.mock('../src/server/context', () => ({ requireViewer: mocks.viewer }));
vi.mock('../src/server/config/store', () => ({ runtimeConfig: mocks.config }));
vi.mock('../src/server/media/storage', () => ({ uploadWorkspaceImage: mocks.upload, readWorkspaceImage: mocks.read }));
vi.mock('../src/server/data-control/guard', () => ({ withWorkspaceOperation: (_id: string, run: () => Promise<unknown>) => run() }));

import { POST } from '../src/app/api/media/route';
import { GET } from '../src/app/api/media/[id]/route';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.viewer.mockResolvedValue({ user: { id: 'user-a' }, workspaceId: 'workspace-a' });
  mocks.config.mockImplementation(async (key: string) => key === 'publishing.maxImageUploadBytes' ? 1024 : key === 'publishing.maxImageUploadRequestOverheadBytes' ? 1024 : undefined);
  mocks.upload.mockResolvedValue({ id: '123e4567-e89b-42d3-a456-426614174000', mimeType: 'image/png', fileName: 'test.png' });
  mocks.read.mockResolvedValue({ bytes: Buffer.from([137, 80, 78, 71]), mimeType: 'image/png', fileName: 'test.png' });
});

function uploadRequest(origin = 'http://localhost', bytes = new Uint8Array([137, 80, 78, 71])) {
  const form = new FormData();
  form.set('imageFile', new File([bytes], 'test.png', { type: 'image/png' }));
  return new Request('http://localhost/api/media', { method: 'POST', headers: { origin }, body: form });
}

describe('workspace media route', () => {
  it('rejects cross-origin upload before reading the viewer', async () => {
    expect((await POST(uploadRequest('http://attacker.test'))).status).toBe(403);
    expect(mocks.viewer).not.toHaveBeenCalled();
  });

  it('rejects oversized multipart bytes before storage is called', async () => {
    const request = uploadRequest('http://localhost', new Uint8Array(4096));
    request.headers.set('content-length', '9999');
    expect((await POST(request)).status).toBe(413);
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it('uploads only inside the authenticated workspace and returns an opaque reference', async () => {
    const response = await POST(uploadRequest());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ reference: 'media:123e4567-e89b-42d3-a456-426614174000' });
    expect(mocks.viewer).toHaveBeenCalledWith({ feature: 'publishing/posts', channelScoped: true, write: true });
    expect(mocks.upload).toHaveBeenCalledWith({ userId: 'user-a', workspaceId: 'workspace-a' }, expect.any(File));
  });

  it('denies anonymous previews and scopes authenticated reads to the current workspace', async () => {
    mocks.viewer.mockRejectedValue(new Error('sign in'));
    const params = { params: Promise.resolve({ id: '123e4567-e89b-42d3-a456-426614174000' }) };
    expect((await GET(new Request('http://localhost/api/media/123'), params)).status).toBe(401);
    expect(mocks.read).not.toHaveBeenCalled();
    mocks.viewer.mockResolvedValue({ user: { id: 'user-a' }, workspaceId: 'workspace-a' });
    const response = await GET(new Request('http://localhost/api/media/123'), params);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(mocks.viewer).toHaveBeenCalledWith({ feature: 'publishing/media', channelScoped: true });
    expect(mocks.read).toHaveBeenCalledWith('workspace-a', '123e4567-e89b-42d3-a456-426614174000');
  });
});
