// @vitest-environment jsdom
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const service = vi.hoisted(() => ({ readChannelProfiles: vi.fn(), changeChannelProfiles: vi.fn(), requireViewer: vi.fn(), selected: vi.fn(), authorize: vi.fn(), config: vi.fn() }));
vi.mock('@/modules/settings/channel-profiles/service', () => service);
vi.mock('@/server/context', () => ({ requireViewer: service.requireViewer }));
vi.mock('@/server/mcp/kit', () => ({ pageIdsFor: (viewer: { permissions: { pageScope: { all: boolean; ids: string[] } } }) => viewer.permissions.pageScope.all ? undefined : viewer.permissions.pageScope.ids }));
vi.mock('@/modules/publishing/server/access', () => ({ authorizePublishing: service.authorize }));
vi.mock('@/modules/publishing/server/read-scope', () => ({ selectedPublishingTargetIds: service.selected, publishingPostVisibilityWhere: () => ({ workspaceId: 'w1' }) }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: service.config }));
import { CHANNEL_PROFILES_MCP } from '@/modules/settings/channel-profiles/mcp';
import { GET, POST } from '@/modules/settings/channel-profiles/http';
import { GroupShortcut } from '@/modules/settings/ui/profiles/GroupShortcut';
import { ProfilesManager } from '@/modules/settings/ui/profiles/ProfilesManager';
import { publishingPostReadQuery } from '@/modules/publishing/server/read-query';
import { profileCopy, profileConfirmationCopy } from '@/modules/settings/channel-profiles/copy';
const directory = { channels: [{ id: 'a', name: 'Alpha', labels: ['North'] }, { id: 'b', name: 'Beta', labels: [] }], groups: [{ id: 'g', name: 'Brand', channelIds: ['a', 'hidden'] }] };
beforeEach(() => {
  vi.clearAllMocks();
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  service.requireViewer.mockResolvedValue({ user: { id: 'u1' }, workspaceId: 'w1' });
  service.readChannelProfiles.mockResolvedValue(directory); service.changeChannelProfiles.mockResolvedValue({ ok: true, id: 'g' });
  service.authorize.mockResolvedValue({ actor: { userId: 'u1', workspaceId: 'w1' }, entitlements: {} });
  service.selected.mockResolvedValue(['a', 'b']); service.config.mockResolvedValue(200);
});
afterEach(() => { document.body.innerHTML = ''; vi.unstubAllGlobals(); });
describe('shared channel profile entry points', () => {
  it('passes current actor and restricted key ceiling to the same MCP service', async () => {
    const viewer = { userId: 'u1', workspaceId: 'w1', permissions: { pageScope: { all: false, ids: ['a'] } } } as never;
    await CHANNEL_PROFILES_MCP.execute(viewer, 'list_channel_profiles', {}, 100);
    expect(service.readChannelProfiles).toHaveBeenCalledWith({ userId: 'u1', workspaceId: 'w1', allowedChannelIds: ['a'] }, 'settings/connections');
    await CHANNEL_PROFILES_MCP.execute(viewer, 'set_channel_profile_labels', { channelId: 'a', labels: [], confirmation: 'SET CHANNEL PROFILE LABELS a' }, 100);
    expect(service.changeChannelProfiles).toHaveBeenCalledWith({ userId: 'u1', workspaceId: 'w1', allowedChannelIds: ['a'] }, { action: 'setLabels', channelId: 'a', labels: [], confirmation: 'SET CHANNEL PROFILE LABELS a' });
    await expect(CHANNEL_PROFILES_MCP.execute(viewer, 'save_channel_group', { action: 'deleteGroup' }, 100)).rejects.toMatchObject({ code: 'invalid_request' });
  });
  it('rejects cross-origin HTTP writes and forwards an authenticated request', async () => {
    const bad = await POST(new Request('https://example.test/settings/profiles/operations', { method: 'POST', headers: { origin: 'https://evil.test' }, body: '{}' }));
    expect(bad.status).toBe(403); expect(service.changeChannelProfiles).not.toHaveBeenCalled();
    const response = await POST(new Request('https://example.test/settings/profiles/operations', { method: 'POST', headers: { origin: 'https://example.test' }, body: JSON.stringify({ action: 'setLabels', channelId: 'a', labels: [], confirmation: 'SET CHANNEL PROFILE LABELS a' }) }));
    expect(await response.json()).toMatchObject({ ok: true });
    expect(service.changeChannelProfiles).toHaveBeenCalledWith({ userId: 'u1', workspaceId: 'w1' }, { action: 'setLabels', channelId: 'a', labels: [], confirmation: 'SET CHANNEL PROFILE LABELS a' });
    expect((await GET(new Request('https://example.test/settings/profiles/operations?workspaceId=other'))).status).toBe(400);
  });
  it('uses selected group ids under existing post visibility and never widens a stale group', async () => {
    service.readChannelProfiles.mockResolvedValue({ ...directory, groups: [{ id: 'g', name: 'Brand', channelIds: ['a'] }] });
    const actor = { userId: 'u1', workspaceId: 'w1' };
    const result = await publishingPostReadQuery(actor, { channelId: 'channel-group:g' });
    expect(service.readChannelProfiles).toHaveBeenCalledWith({ ...actor, allowedChannelIds: ['a', 'b'] }, 'publishing/posts');
    expect(result.where.AND).toContainEqual({ targets: { some: { targetId: { in: ['a'] } } } });
    const stale = await publishingPostReadQuery(actor, { channelId: 'channel-group:deleted' });
    expect(stale.channelUnavailable).toBe(true);
    expect(stale.where.AND).toContainEqual({ targets: { some: { targetId: { in: [] } } } });
  });
  it('renders English and French forms with named inputs and no native validation', () => {
    for (const locale of ['en', 'fr'] as const) {
      const html = renderToStaticMarkup(React.createElement(ProfilesManager, { initial: directory, locale, canManage: true }));
      expect(html).toContain(profileCopy[locale].name); expect(html).toContain('noValidate=""');
      expect(html).toContain('North'); expect(html).toContain('aria-busy="false"');
    }
  });
  it('applies only available group members to Analytics form checkboxes', async () => {
    const host = document.createElement('div'); document.body.appendChild(host); const root = createRoot(host);
    await act(async () => root.render(React.createElement('form', null, React.createElement(GroupShortcut, { groups: directory.groups, allowedIds: ['a', 'b'] }), React.createElement('input', { type: 'checkbox', name: 'channel', value: 'a' }), React.createElement('input', { type: 'checkbox', name: 'channel', value: 'b', defaultChecked: true }))));
    await act(async () => host.querySelector<HTMLButtonElement>('[role=combobox]')!.click());
    await act(async () => { const option = [...host.querySelectorAll<HTMLElement>('[role=option]')].find(item => item.textContent === directory.groups[0]!.name)!; option.click(); });
    expect(host.querySelector<HTMLInputElement>('input[value="a"]')!.checked).toBe(true);
    expect(host.querySelector<HTMLInputElement>('input[value="b"]')!.checked).toBe(false);
    expect(host.textContent).not.toContain('hidden');
    expect(host.querySelector('input[name=channel][value=hidden]')).toBeNull();
    await act(async () => root.unmount());
  });
  it('passes scoped group selections to a controlled composer', async () => {
    const host = document.createElement('div'); document.body.appendChild(host); const root = createRoot(host); const selectIds = vi.fn();
    await act(async () => root.render(React.createElement(GroupShortcut, { groups: directory.groups, allowedIds: ['a'], onSelect: selectIds, locale: 'fr' })));
    await act(async () => host.querySelector<HTMLButtonElement>('[role=combobox]')!.click());
    await act(async () => { const option = [...host.querySelectorAll<HTMLElement>('[role=option]')].find(item => item.textContent === directory.groups[0]!.name)!; option.click(); });
    expect(selectIds).toHaveBeenCalledWith(['a']);
    await act(async () => root.unmount());
  });
  it('retains label input after a failed save and refreshes after a confirmed retry', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response('{}', { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, id: 'a' })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...directory, channels: [{ id: 'a', name: 'Alpha', labels: ['Updated'] }] })));
    vi.stubGlobal('fetch', fetcher);
    const host = document.createElement('div'); document.body.appendChild(host); const root = createRoot(host);
    await act(async () => root.render(React.createElement(ProfilesManager, { initial: directory, locale: 'en', canManage: true })));
    const input = host.querySelector<HTMLInputElement>('input[name="labels"]')!; input.value = 'Updated';
    await act(async () => { input.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    await act(async () => { const button = [...document.querySelectorAll('button')].find(button => button.textContent === profileConfirmationCopy.en.confirm)!; button.click(); });
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(profileCopy.en.failure);
    expect(input.value).toBe('Updated');
    await act(async () => { input.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    await act(async () => { const button = [...document.querySelectorAll('button')].find(button => button.textContent === profileConfirmationCopy.en.confirm)!; button.click(); });
    expect(host.querySelector('[role="status"]')?.textContent).toContain(profileCopy.en.success);
    expect(host.querySelector<HTMLInputElement>('input[name="labels"]')!.value).toBe('Updated');
    expect(JSON.parse(fetcher.mock.calls[1]![1].body)).toMatchObject({ action: 'setLabels', channelId: 'a', labels: ['Updated'], confirmation: 'SET CHANNEL PROFILE LABELS a' });
    await act(async () => root.unmount());
  });

});


it('requires confirmation on every MCP write declaration', () => {
  for (const name of CHANNEL_PROFILES_MCP.writeTools!) expect(CHANNEL_PROFILES_MCP.tools.find(tool => tool.name === name)?.inputSchema.required).toContain('confirmation');
});

it('uses Root-provided French confirmation copy and cancels label changes without a request', async () => {
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
  const copy = { title: 'Vérifier le profil', saveGroup: 'Valider {name} ({count})', setLabels: 'Valider les libellés de {name}', cancel: 'Conserver', confirm: 'Valider' };
  const host = document.createElement('div'); document.body.appendChild(host); const root = createRoot(host);
  await act(async () => root.render(React.createElement(ProfilesManager, { initial: directory, locale: 'fr', canManage: true, confirmationCopy: copy })));
  const input = host.querySelector<HTMLInputElement>('input[name="labels"]')!; input.value = 'Updated';
  await act(async () => input.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(fetcher).not.toHaveBeenCalled(); expect(host.textContent).toContain(copy.title); expect(host.textContent).toContain('Valider les libellés de Alpha');
  await act(async () => { [...document.querySelectorAll('button')].find(button => button.textContent === copy.cancel)!.click(); });
  expect(fetcher).not.toHaveBeenCalled(); expect(input.value).toBe('Updated'); expect(host.querySelector('dialog')).toBeNull();
  await act(async () => root.unmount());
});
