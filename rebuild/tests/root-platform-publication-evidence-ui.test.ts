import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ access: vi.fn(), read: vi.fn(), noHook: false, policy: vi.fn(), copy: vi.fn() }));
vi.mock('../src/server/config/access', () => ({ requireRootPage: state.access }));
vi.mock('../src/server/root/platform-publication-evidence', () => ({ readRootPlatformPublicationEvidence: state.read, loadRootEvidencePolicy: state.policy, loadRootEvidenceCopy: state.copy }));
vi.mock('../src/server/platforms/publication-recovery', () => ({ installedPublicationRecovery: () => state.noHook ? undefined : { readEvidence: vi.fn() } }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('../src/components/SidebarDock', () => ({ SidebarDock: ({ children }: { children: import('react').ReactNode }) => children }));
import { RootPlatformPublicationEvidence } from '../src/server/root/RootPlatformPublicationEvidence';
import { OperationError } from '../src/lib/operation-error';
import { ROOT_EVIDENCE_POLICY } from '../src/lib/config/root-evidence-policy';
import { ROOT_EVIDENCE_COPY } from '../src/lib/config/root-evidence-copy';

beforeEach(() => { vi.clearAllMocks(); state.noHook = false; state.policy.mockResolvedValue(ROOT_EVIDENCE_POLICY); state.copy.mockResolvedValue(ROOT_EVIDENCE_COPY); state.access.mockResolvedValue({ id: 'root' }); state.read.mockResolvedValue({ providerId: 'platform', title: 'Module upload receipts', description: 'Known receipt identifiers.', columns: [{ key: 'operationId', label: 'Publication operation' }, { key: 'remoteId', label: 'Remote receipt' }], items: [{ operationId: 'op_1', remoteId: 'receipt_1' }], truncated: false }); });

describe('generic Root platform publication evidence panel', () => {
  it('uses module-owned labels and values in the shared table', async () => {
    const html = renderToStaticMarkup(await RootPlatformPublicationEvidence({ providerId: 'platform' }));
    expect(html).toContain('Module upload receipts'); expect(html).toContain('Publication operation'); expect(html).toContain('receipt_1');
    expect(html).toContain('Any available action requires its own module-defined confirmation'); expect(state.read).toHaveBeenCalledWith('root', { providerId: 'platform' }, ROOT_EVIDENCE_POLICY, ROOT_EVIDENCE_COPY);
    expect(html).toContain('name="operationId"'); expect(html).toContain('action="/root/platforms/platform"');
    expect(html).toContain('Apply filter'); expect(html).toContain('href="/root/platforms/platform"'); expect(html).toContain('Reset filter');
  });
  it('renders only module-declared row actions with module-owned confirmation and acknowledgement text', async () => {
    state.read.mockResolvedValueOnce({ providerId: 'platform', title: 'Evidence', description: 'Known receipts.', columns: [{ key: 'receipt', label: 'Receipt' }], items: [{ receipt: 'row_1' }], rowIdKey: 'receipt', actions: [{ rowId: 'row_1', actionId: 'module_action', subjectId: 'row_1', label: 'Resolve receipt', description: 'Review this stored receipt.', acknowledgmentLabel: 'I checked this receipt', confirmation: 'RESOLVE row_1' }], truncated: false });
    const html = renderToStaticMarkup(await RootPlatformPublicationEvidence({ providerId: 'platform' }));
    expect(html).toContain('Resolve receipt'); expect(html).toContain('name="operationId"');
    expect(html).not.toContain('Facebook'); expect(html).toContain('Actions');
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
    expect(state.read).toHaveBeenCalledWith('root', { providerId: 'platform', operationId: 'bad value' }, ROOT_EVIDENCE_POLICY, ROOT_EVIDENCE_COPY);
  });
  it('keeps field errors associated when Root changes the validation copy', async () => {
    state.copy.mockResolvedValue({ ...ROOT_EVIDENCE_COPY, invalidOperationId: 'Use a receipt identifier of at most {limit} characters.' });
    state.read.mockRejectedValueOnce(new OperationError('invalid_request', 'Safe validation text.'));
    const html = renderToStaticMarkup(await RootPlatformPublicationEvidence({ providerId: 'platform', operationId: 'bad value' }));
    expect(html).toContain('Use a receipt identifier of at most 200 characters.');
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('aria-describedby="root-platform-publication-evidence-error"');
  });
  it('treats a cleared sidebar field as the unfiltered history', async () => {
    const html = renderToStaticMarkup(await RootPlatformPublicationEvidence({ providerId: 'platform', operationId: '' }));
    expect(state.read).toHaveBeenCalledWith('root', { providerId: 'platform' }, ROOT_EVIDENCE_POLICY, ROOT_EVIDENCE_COPY);
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
