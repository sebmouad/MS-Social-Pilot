import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ viewer: vi.fn(), list: vi.fn() }));
vi.mock('@/server/context', () => ({ requireViewer: h.viewer }));
vi.mock('@/modules/publishing/server/saved-views', () => ({ listSavedViews: h.list, createSavedView: vi.fn() }));

import { GET } from '../src/app/api/publishing/saved-views/route';
import { OperationError } from '../src/lib/operation-error';

const css = (path: string) => readFileSync(new URL(`../src/modules/settings/ui/${path}`, import.meta.url), 'utf8');
const rule = (source: string, selector: string) => source.split('\n').find(line => line.startsWith(`${selector} {`)) ?? '';

describe('team settings cannot widen the page', () => {
  it.each(['team/team.module.css', 'team/invitations.module.css'])('%s anchors its visually hidden table text inside the scroll region', file => {
    const source = css(file);
    expect(rule(source, '.tableWrap')).toContain('position: relative');
    expect(rule(source, '.tableWrap')).toContain('overflow-x: auto');
    expect(rule(source, '.visuallyHidden')).toMatch(/position: absolute; inset-inline-start: 0; top: 0;/);
  });
  it('lets the shared settings grid shrink below its widest child', () => {
    expect(rule(css('settings.module.css'), '.settings-page')).toContain('grid-template-columns: minmax(0, 1fr)');
  });
});

describe('saved views list stays quiet when storage is temporarily unavailable', () => {
  beforeEach(() => { h.viewer.mockReset().mockResolvedValue({ user: { id: 'u' }, workspaceId: 'w' }); h.list.mockReset(); });
  const get = () => GET(new Request('https://app.example/api/publishing/saved-views?screen=posts'));
  it('answers 200 with an unavailable flag instead of a failed request', async () => {
    h.list.mockRejectedValue(new OperationError('unavailable', 'Saved views are temporarily unavailable.'));
    const response = await get();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ views: [], unavailable: true, code: 'unavailable' });
  });
  it('still reports other failures with their status', async () => {
    h.list.mockRejectedValue(new OperationError('forbidden', 'No access.'));
    expect((await get()).status).toBeGreaterThanOrEqual(400);
  });
});
