// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PublishingPagination } from '../src/modules/publishing/ui/publishing-ui';
import { EmptyState, WorkList, WorkRow } from '../src/modules/publishing/ui/worklist';

const css = (path: string) => readFileSync(path, 'utf8');
const publishing = 'src/modules/publishing/ui/';

describe('Publishing markup states', () => {
  it('marks the current page in the pagination and hides it for a single page', () => {
    const html = renderToStaticMarkup(createElement(PublishingPagination, { path: '/publishing/queue', page: 2, pages: 3, locale: 'fr' }));
    expect(html).toMatch(/<span aria-current="page">/);
    expect(html).toContain('href="/publishing/queue?page=1"');
    expect(html).toContain('href="/publishing/queue?page=3"');
    expect(renderToStaticMarkup(createElement(PublishingPagination, { path: '/x', page: 1, pages: 1 }))).toBe('');
  });
  it('renders an empty work list state with a heading and explanation', () => {
    const html = renderToStaticMarkup(createElement(EmptyState, { title: 'Nothing waiting', children: 'Posts appear here.' }));
    expect(html).toContain('<h2>Nothing waiting</h2>');
    expect(html).toContain('Posts appear here.');
  });
  it('keeps the labelled list and row actions in work rows', () => {
    const html = renderToStaticMarkup(createElement(WorkList, { label: 'Approvals', children: createElement(WorkRow, { chip: 'Pending', when: 'Today', actions: createElement('button', null, 'Approve'), children: 'Text' }) }));
    expect(html).toContain('aria-label="Approvals"');
    expect(html).toContain('Approve');
  });
});

describe('Publishing styles', () => {
  const composer = css(`${publishing}compose/PostComposer.module.css`);
  const page = css(`${publishing}publishing.module.css`);
  const work = css(`${publishing}worklist.module.css`);
  it('gives composer fields the shared themed focus ring and an invalid ring', () => {
    expect(composer).toMatch(/\.form textarea:focus-visible[^{]*\{[^}]*var\(--ui-ring\)/);
    expect(composer).toMatch(/\.form \[aria-invalid="true"\]:focus-visible[^{]*\{[^}]*var\(--danger\)/);
  });
  it('stacks date, time and destination controls on phones', () => {
    expect(composer).toMatch(/max-width: 540px\)[^]*\.dateTime \{ grid-template-columns: minmax\(0, 1fr\)/);
  });
  it('gives filters, tabs and rows keyboard focus and 44px targets', () => {
    expect(page).toMatch(/\.postFilters select:focus-visible/);
    expect(page).toMatch(/\.tab \{ min-height: 44px/);
    expect(work).toMatch(/\.row:focus-within/);
    expect(work).toMatch(/\.reviewButtons > \* \{ flex: 1 1 120px; min-height: 44px/);
  });
  it('respects reduced motion for the added transitions', () => {
    expect(composer).toMatch(/prefers-reduced-motion: reduce\) \{ \.chosen li \{ transition: none/);
    expect(work).toMatch(/prefers-reduced-motion: reduce\) \{ \.row \{ transition: none/);
  });
  it('uses theme tokens only in the polish blocks', () => {
    for (const source of [composer, page, work]) {
      const block = source.slice(source.indexOf('UX polish'));
      expect(block).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(block).not.toMatch(/rgba?\(/);
    }
  });
});

describe('Settings styles', () => {
  const settings = css('src/modules/settings/ui/settings.module.css');
  const block = settings.slice(settings.indexOf('UX polish'));
  it('shows keyboard focus on tabs, row actions and custom buttons', () => {
    expect(block).toMatch(/\.settings-tabs a:focus-visible/);
    expect(block).toMatch(/\.data-danger-button:focus-visible/);
    expect(block).toMatch(/var\(--ui-ring\)/);
  });
  it('gives the connection dialog a phone layout with full-width actions and 44px targets', () => {
    expect(block).toMatch(/@media \(max-width: 620px\)[^]*\.connection-dialog footer > \* \{ flex: 1 1 140px; min-height: 44px/);
    expect(block).toMatch(/\.connection-dialog > header > button \{ width: 44px; height: 44px/);
  });
  it('turns the empty message into a dashed surface and uses tokens only', () => {
    expect(block).toMatch(/\.settings-empty \{ border: 1px dashed var\(--line-strong\)/);
    expect(block).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});
