import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ access: vi.fn(), config: vi.fn(), copy: vi.fn(), read: vi.fn(), form: vi.fn() }));
vi.mock('../src/server/config/access', () => ({ requireRootPage: state.access }));
vi.mock('../src/server/config/store', () => ({ readConfig: state.read, runtimeConfig: state.config }));
vi.mock('../src/modules/root/ui/RootFrame', () => ({ RootFrame: 'main' }));
vi.mock('../src/modules/root/ui/RootDiagnostics', () => ({ RootDiagnostics: async () => createElement('section', null, 'Shared diagnostics') }));
vi.mock('../src/modules/root/ui/RootJobHealth', () => ({ RootJobHealth: async () => createElement('section', null, 'Job health') }));
vi.mock('../src/modules/root/ui/RootMonitoring', () => ({ RootMonitoring: async () => createElement('section', null, 'Monitoring') }));
vi.mock('../src/app/root/config/root-config-form', () => ({ RootConfigForm: state.form }));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('../src/server/data', () => ({ prisma: { user: { findUnique: async () => ({ isInstanceOwner: true, disabledAt: null }) } } }));
import OperationsPage from '../src/app/root/operations/page';
import SharedPage from '../src/app/root/config/page';
import { rootAreas, rootActiveHref, rootAreaFor } from '../src/modules/root/ui/root-areas';
import { ROOT_INTERFACE_COPY } from '../src/lib/config/root-interface-copy';
import { rootManifest } from '../src/modules/root/manifest';

beforeEach(() => {
  vi.clearAllMocks();
  state.access.mockResolvedValue({ id: 'root' });
  state.config.mockImplementation(async (key: string) => { throw new Error(`no stored ${key}`); });
  state.read.mockResolvedValue([
    { key: 'auth.sessionDays', value: 30 }, { key: 'publishing.maxMessageCharacters', value: 10000 },
    { key: 'entitlements.modules.publishing', value: true }, { key: 'meta.appSecret', value: '', isSet: true },
  ]);
  state.form.mockImplementation(() => createElement('section', null, 'Owned settings'));
});

describe('Root areas', () => {
  it('gives every shared page exactly one area home', () => {
    const shared = rootManifest.sections[0]!.pages.map(page => page.href);
    const copy = ROOT_INTERFACE_COPY.en;
    const areas = rootAreas({ overview: copy.areaOverview, people: copy.areaPeople, modules: copy.areaModules, operations: copy.areaOperations, activity: copy.areaActivity });
    const homed = areas.flatMap(area => area.pages.map(page => page.href));
    for (const href of shared) expect(homed.filter(page => page === href)).toHaveLength(1);
    expect(new Set(homed).size).toBe(homed.length);
    expect(areas.map(area => area.id)).toEqual(['overview', 'people', 'modules', 'operations', 'activity']);
    expect(areas[1]!.label).toBe('People');
  });
  it('maps detail pages to their parent area', () => {
    expect(rootActiveHref('/root/modules/publishing')).toBe('/root/modules');
    expect(rootActiveHref('/root/platforms/facebook')).toBe('/root/platforms');
    expect(rootActiveHref('/root/errors/abc')).toBe('/root/errors');
    expect(rootAreaFor('/root/modules/publishing')).toBe('modules');
    expect(rootAreaFor('/root/users')).toBe('people');
    expect(rootAreaFor('/root/activity')).toBe('activity');
  });
  it('splits Operations into jobs and diagnostics tabs', async () => {
    const jobs = renderToStaticMarkup(await OperationsPage({ searchParams: Promise.resolve({}) }));
    expect(jobs).toContain('Job health');
    expect(jobs).toContain('Monitoring');
    expect(jobs).not.toContain('Shared diagnostics');
    const diagnostics = renderToStaticMarkup(await OperationsPage({ searchParams: Promise.resolve({ tab: 'diagnostics' }) }));
    expect(diagnostics).toContain('Shared diagnostics');
    expect(diagnostics).not.toContain('Job health');
  });
  it('splits shared configuration into settings and availability tabs', async () => {
    const settings = renderToStaticMarkup(await SharedPage({ searchParams: Promise.resolve({}) }));
    expect(settings).toContain('Owned settings');
    const availability = renderToStaticMarkup(await SharedPage({ searchParams: Promise.resolve({ tab: 'availability' }) }));
    expect(availability).not.toContain('Owned settings');
    expect(availability).toContain('publishing/posts');
  });
});
