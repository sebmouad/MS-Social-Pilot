import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ access: vi.fn(), read: vi.fn(), noHook: false }));
vi.mock('../src/server/config/access', () => ({ requireRootPage: state.access }));
vi.mock('../src/server/root/platform-publication-evidence', () => ({ readRootPlatformPublicationEvidence: state.read }));
vi.mock('../src/server/platforms/publication-recovery', () => ({ installedPublicationRecovery: () => state.noHook ? undefined : { readEvidence: vi.fn() } }));
vi.mock('../src/components/SidebarDock', () => ({ SidebarDock: ({ children }: { children: import('react').ReactNode }) => children }));
import { RootPlatformPublicationEvidence } from '../src/server/root/RootPlatformPublicationEvidence';
import { OperationError } from '../src/lib/operation-error';

beforeEach(() => { vi.clearAllMocks(); state.noHook = false; state.access.mockResolvedValue({ id: 'root' }); state.read.mockResolvedValue({ providerId: 'platform', title: 'Module upload receipts', description: 'Known receipt identifiers.', columns: [{ key: 'operationId', label: 'Publication operation' }, { key: 'remoteId', label: 'Remote receipt' }], items: [{ operationId: 'op_1', remoteId: 'receipt_1' }], truncated: false }); });

describe('generic Root platform publication evidence panel', () => {
  it('uses module-owned labels and values in the shared table', async () => {
    const html = renderToStaticMarkup(await RootPlatformPublicationEvidence({ providerId: 'platform' }));
    expect(html).toContain('Module upload receipts'); expect(html).toContain('Publication operation'); expect(html).toContain('receipt_1');
    expect(html).toContain('Read-only evidence'); expect(state.read).toHaveBeenCalledWith('root', { providerId: 'platform' });
    expect(html).toContain('name="operationId"'); expect(html).toContain('action="/root/platforms/platform"');
    expect(html).toContain('Apply filter'); expect(html).toContain('href="/root/platforms/platform"'); expect(html).toContain('Reset filter');
  });
  it('distinguishes an empty history from unavailable evidence and reports truncation', async () => {
    state.read.mockResolvedValueOnce({ providerId: 'platform', title: 'Receipts', description: 'Bounded history.', columns: [{ key: 'id', label: 'Receipt' }], items: [], truncated: false });
    const empty = renderToStaticMarkup(await RootPlatformPublicationEvidence({ providerId: 'platform' }));
    expect(empty).toContain('No publication evidence is recorded'); expect(empty).not.toContain('role="alert"');
    state.read.mockResolvedValueOnce({ providerId: 'platform', title: 'Receipts', description: 'Bounded history.', columns: [{ key: 'id', label: 'Receipt' }], items: [{ id: 'known' }], truncated: true });
    const truncated = renderToStaticMarkup(await RootPlatformPublicationEvidence({ providerId: 'platform' }));
    expect(truncated).toContain('history is truncated');
    expect(truncated).toContain('Configured limits still apply to a single operation.');
    expect(truncated).not.toContain('complete step history');
    state.read.mockRejectedValueOnce(new Error('token=private'));
    const failed = renderToStaticMarkup(await RootPlatformPublicationEvidence({ providerId: 'platform' }));
    expect(failed).toContain('Publication evidence unavailable'); expect(failed).not.toContain('private');
  });
  it('keeps the GET filter value and a field-linked error visible after invalid input', async () => {
    state.read.mockRejectedValueOnce(new OperationError('invalid_request', 'Safe validation text.'));
    const html = renderToStaticMarkup(await RootPlatformPublicationEvidence({ providerId: 'platform', operationId: 'bad value' }));
    expect(html).toContain('value="bad value"'); expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('aria-describedby="root-platform-publication-evidence-error"');
    expect(html).toContain('Enter one operation ID'); expect(html).toContain('Reset filter');
    expect(state.read).toHaveBeenCalledWith('root', { providerId: 'platform', operationId: 'bad value' });
  });
  it('treats a cleared sidebar field as the unfiltered history', async () => {
    const html = renderToStaticMarkup(await RootPlatformPublicationEvidence({ providerId: 'platform', operationId: '' }));
    expect(state.read).toHaveBeenCalledWith('root', { providerId: 'platform' });
    expect(html).not.toContain('Publication evidence unavailable');
  });
  it('omits the panel and sidebar filter if the installed module has no evidence hook', async () => {
    state.noHook = true;
    expect(renderToStaticMarkup(await RootPlatformPublicationEvidence({ providerId: 'platform' }))).toBe('');
    expect(state.read).not.toHaveBeenCalled();
  });
  it('keeps the platform panel inside the existing module settings content', async () => {
    const page = await import('../src/app/root/platforms/[id]/page');
    const tree = await page.default({ params: Promise.resolve({ id: 'facebook' }), searchParams: Promise.resolve({ operationId: 'op_from_url' }) });
    const html = renderToStaticMarkup(tree.props.children[0]);
    expect(html).toContain('Declared operations');
    expect(tree.props.children[1].type).toBe(RootPlatformPublicationEvidence);
    expect(tree.props.children[1].props.operationId).toBe('op_from_url');
  });
});
