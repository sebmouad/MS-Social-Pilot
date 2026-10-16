import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ access: vi.fn(), read: vi.fn(), form: vi.fn() }));
vi.mock('../src/server/root/RootDiagnostics', () => ({ RootDiagnostics: async () => null }));
vi.mock('../src/server/jobs/RootJobHealth', () => ({ RootJobHealth: async () => null }));
vi.mock('../src/server/config/access', () => ({ requireRootPage: state.access }));
vi.mock('../src/server/config/store', () => ({ readConfig: state.read }));
vi.mock('../src/server/root/RootFrame', () => ({ RootFrame: 'main' }));
vi.mock('../src/app/root/config/root-config-form', () => ({ RootConfigForm: state.form }));
vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('Not found'); } }));
import { RootModuleSettings } from '../src/server/root/RootModuleSettings';
import ProductPage from '../src/app/root/modules/[id]/page';
import PlatformPage from '../src/app/root/platforms/[id]/page';
import ModulesPage from '../src/app/root/modules/page';
import SharedPage from '../src/app/root/config/page';
import { moduleManifests } from '../src/modules';

beforeEach(() => {
  vi.clearAllMocks();
  state.access.mockResolvedValue({ id: 'root' });
  state.read.mockResolvedValue([
    { key: 'auth.sessionDays', value: 30 }, { key: 'publishing.maxMessageCharacters', value: 10000 },
    { key: 'entitlements.modules.publishing', value: true }, { key: 'meta.appSecret', value: '', isSet: true },
  ]);
  state.form.mockImplementation(() => createElement('section', null, 'Owned settings'));
});
describe('Root module screens', () => {
  it('gives each module only its settings and feature inventory', async () => {
    renderToStaticMarkup(await RootModuleSettings({ kind: 'product', id: 'publishing', title: 'Publishing', description: 'Publishing controls' }));
    const props = state.form.mock.calls[0][0];
    expect(props.definitions.length).toBeGreaterThan(5);
    expect(props.definitions.every((setting: { owner: { kind: string; id: string } }) => setting.owner.kind === 'product' && setting.owner.id === 'publishing')).toBe(true);
    expect(props.initialValues.map((setting: { key: string }) => setting.key)).toEqual(['publishing.maxMessageCharacters', 'entitlements.modules.publishing']);
    expect(props.availability.modules.map((module: { id: string }) => module.id)).toEqual(['publishing']);
  });
  it('keeps provider-owned credentials and reply policy together', async () => {
    renderToStaticMarkup(await RootModuleSettings({ kind: 'platform', id: 'facebook', title: 'Facebook', description: 'Provider controls' }));
    const keys = state.form.mock.calls[0][0].definitions.map((setting: { key: string }) => setting.key);
    expect(keys).toContain('meta.appSecret'); expect(keys).toContain('inbox.messengerReplyWindowHours');
    expect(keys).not.toContain('publishing.maxMessageCharacters');
  });
  it('excludes product and provider settings from shared configuration', async () => {
    renderToStaticMarkup(await SharedPage());
    const props = state.form.mock.calls[0][0];
    expect(props.definitions.every((setting: { owner: { kind: string } }) => setting.owner.kind === 'shared')).toBe(true);
    expect(props.initialValues.map((setting: { key: string }) => setting.key)).toEqual(['auth.sessionDays']);
  });
  it('keeps navigation and safe recovery copy when the settings store fails', async () => {
    state.read.mockRejectedValueOnce(new Error('postgres://private-password@db'));
    const html = renderToStaticMarkup(await RootModuleSettings({ kind: 'product', id: 'publishing', title: 'Publishing', description: 'Publishing controls' }));
    expect(html).toContain('Module settings unavailable');
    expect(html).not.toContain('private-password'); expect(state.form).not.toHaveBeenCalled();
  });
  it('authenticates all module entry routes before exposing controls', async () => {
    state.access.mockRejectedValue(new Error('Root required'));
    for (const promise of [ProductPage({ params: Promise.resolve({ id: 'publishing' }) }), PlatformPage({ params: Promise.resolve({ id: 'facebook' }) }), ModulesPage(), SharedPage(), RootModuleSettings({ kind: 'product', id: 'publishing', title: 'Publishing', description: 'Controls' })]) await expect(promise).rejects.toThrow('Root required');
    expect(state.read).not.toHaveBeenCalled();
  });
  it('refuses uninstalled modules and lists only installed products', async () => {
    await expect(ProductPage({ params: Promise.resolve({ id: 'uninstalled' }) })).rejects.toThrow('Not found');
    await expect(PlatformPage({ params: Promise.resolve({ id: 'uninstalled' }) })).rejects.toThrow('Not found');
    const html = renderToStaticMarkup(await ModulesPage());
    for (const module of moduleManifests) expect(html).toContain(`/root/modules/${module.id}`);
  });
});
