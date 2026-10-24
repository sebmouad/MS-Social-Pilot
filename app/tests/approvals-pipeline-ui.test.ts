// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ContentProvider } from '../src/modules/publishing/ui/ContentProvider';
import { contentCopyDefaults, contentPolicyDefaults, resolveContentCopy } from '../src/modules/publishing/ui/content-copy';
import { PublishingCopyProvider } from '../src/modules/publishing/ui/kit/CopyProvider';
import { publishingCopyDefaults } from '../src/modules/publishing/ui/kit/copy';
import { PublishingActionCopyProvider } from '../src/modules/publishing/ui/WorkflowSubmitButtons';
import { publishingActionCopy } from '../src/modules/publishing/action-catalog';
import { ComposerCopyProvider } from '../src/modules/publishing/ui/compose/CopyProvider';
import { composerCatalogDefaults } from '../src/modules/publishing/composer-catalog';
import { ApprovalPipeline, type PipelineRow, type PipelineStage } from '../src/modules/publishing/ui/approvals/ApprovalPipeline';

let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;

const row = (id: string, overrides: Partial<PipelineRow> = {}): PipelineRow => ({
  id, authorId: 'u2', message: `Post ${id}`, firstComment: null, link: null, media: [], status: 'draft',
  scheduledAt: null, publishedAt: null, createdAt: new Date('2026-10-20T10:00:00Z'), displayTime: 'Oct 20',
  targets: [{ status: 'pending', remotePostId: null, remoteUrl: null, target: { id: 'c1', type: 'page', name: 'Studio', pictureUrl: null } }],
  authorName: 'Amina', whenLabel: 'Oct 20, 2026', canSubmit: false,
  notes: [{ id: `n-${id}`, body: `Note on ${id}`, authorId: 'u3', authorName: 'Karim', createdAt: '2026-10-20T11:00:00.000Z', createdLabel: 'Oct 20, 2026 UTC' }],
  mentionable: [], noteMax: 500, notesUnavailable: false, ...overrides,
});
const stage = (id: PipelineStage['id'], title: string, empty: string, rows: PipelineRow[], total: number): PipelineStage =>
  ({ id, title, empty, total, rows, viewAllHref: `/content?status=${id}` });

async function render(stages: PipelineStage[], locale: 'en' | 'fr' = 'en', reviewAction = vi.fn()) {
  const pipeline = createElement(ApprovalPipeline, { stages, locale, timeZone: 'UTC', viewerId: 'u1', canReview: true, canWriteNotes: true, canModerateNotes: false, reviewAction });
  const composer = createElement(ComposerCopyProvider, { catalog: composerCatalogDefaults, locale, children: pipeline });
  const actions = createElement(PublishingActionCopyProvider, { catalog: publishingActionCopy, locale, children: composer });
  const copy = createElement(PublishingCopyProvider, { catalog: publishingCopyDefaults, locale, children: actions });
  await act(async () => root.render(createElement(ContentProvider, { copy: resolveContentCopy(contentCopyDefaults as never, locale), policy: contentPolicyDefaults, locale, children: copy })));
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

describe('approval pipeline', () => {
  const stages = () => [
    stage('draft', 'Draft', 'No drafts waiting.', [row('d1', { canSubmit: true })], 1),
    stage('review', 'In review', 'Nothing waiting for review.', [row('r1', { status: 'pending_approval' })], 3),
    stage('approved', 'Approved', 'No approved posts.', [], 0),
    stage('scheduled', 'Scheduled', 'Nothing scheduled.', [row('s1', { status: 'scheduled', stageNote: 'Approved by Lina' })], 1),
  ];
  it('renders the four stages with counts, cards and per-stage overflow links', async () => {
    await render(stages());
    const headings = [...container.querySelectorAll('[class*="stageHead"] h2')].map(h => h.textContent);
    expect(headings).toEqual(['Draft', 'In review', 'Approved', 'Scheduled']);
    expect(container.textContent).toContain('3 posts');
    expect(container.textContent).toContain('No approved posts.');
    const viewAll = [...container.querySelectorAll('a')].find(a => a.textContent === 'View all 3 in Posts')!;
    expect(viewAll.getAttribute('href')).toBe('/content?status=review');
    expect([...container.querySelectorAll('a')].filter(a => a.textContent === 'Open post')).toHaveLength(2);
  });
  it('keeps approve/reject decisions and the submit action on the right cards', async () => {
    const reviewAction = vi.fn();
    await render(stages(), 'en', reviewAction);
    const reviewSection = [...container.querySelectorAll('section')].find(section => section.querySelector('h2')?.textContent === 'In review')!;
    expect([...reviewSection.querySelectorAll('button')].map(button => button.textContent)).toEqual(expect.arrayContaining(['Approve', 'Request changes']));
    const draftSection = [...container.querySelectorAll('section')].find(section => section.querySelector('h2')?.textContent === 'Draft')!;
    expect([...draftSection.querySelectorAll('button')].map(button => button.textContent)).toContain('Submit for approval');
    expect([...draftSection.querySelectorAll('button')].map(button => button.textContent)).not.toContain('Approve');
    expect(container.textContent).toContain('Approved by Lina');
  });
  it('attaches each post’s comments thread and reports an unavailable one honestly', async () => {
    const rows = stages();
    rows[0]!.rows = [row('d1', { canSubmit: true, notes: [], notesUnavailable: true })];
    await render(rows);
    expect(container.textContent).toContain('Note on r1');
    expect(container.textContent).toContain('Note on s1');
    expect(container.textContent).toContain('Comments could not be loaded.');
  });
  it('renders French stage copy from the owning catalog', async () => {
    await render([
      stage('draft', 'Brouillon', 'Aucun brouillon en attente.', [], 0),
      stage('review', 'En relecture', 'Rien en attente de relecture.', [], 0),
      stage('approved', 'Approuvé', 'Aucune publication approuvée.', [], 0),
      stage('scheduled', 'Programmé', 'Rien de programmé.', [], 0),
    ], 'fr');
    expect(container.textContent).toContain('Aucun brouillon en attente.');
    expect(container.querySelector('[aria-label="Circuit d’approbation"]')).not.toBeNull();
  });
});
