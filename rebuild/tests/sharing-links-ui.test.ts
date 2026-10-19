// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LinksManager } from '../src/modules/sharing/ui/links/LinksManager';

vi.mock('../src/modules/sharing/ui/links/sharing.module.css', () => ({ default: {} }));
vi.mock('../src/modules/settings/ui/settings.module.css', () => ({ default: {} }));

const channels = [{ id: 'c1', name: 'Bakery page' }, { id: 'c2', name: 'Shop page' }, { id: 'c3', name: 'Blog page' }];
const limits = { titleMax: 240, descriptionMax: 2000, defaultExpiryDays: 30, maxExpiryDays: 365 };
const link = (extra: Record<string, unknown> = {}) => ({ id: 'shl_secret-internal-id', kind: 'review', title: 'Spring campaign', description: null, targetIds: ['c1'], daysBack: 7, daysAhead: 30, allowComments: true, decides: false, status: 'active', expiresAt: new Date(Date.now() + 5 * 86_400_000).toISOString(), createdAt: new Date().toISOString(), feedbackCount: 2, version: 'a'.repeat(32), ...extra });
const json = (body: unknown, ok = true) => ({ ok, json: async () => body });

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let fetchMock: ReturnType<typeof vi.fn>;
async function mount(links = [link()], extra: Record<string, unknown> = {}) {
  await act(async () => root.render(createElement(LinksManager, { initial: { links, page: 1, hasMore: false }, channels, limits, canApprove: true, ...extra } as never)));
}
const button = (text: string | RegExp) => [...document.querySelectorAll('button')].find(b => typeof text === 'string' ? b.textContent === text : text.test(b.textContent ?? ''))!;
const click = (el: Element) => act(async () => { (el as HTMLElement).click(); });
async function type(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => { Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })); });
}
const field = (label: string) => [...document.querySelectorAll('label')].find(l => l.textContent?.startsWith(label))!.querySelector('input,textarea,select') as HTMLInputElement;
const checkbox = (label: string | RegExp) => [...document.querySelectorAll<HTMLLabelElement>('label')].find(l => typeof label === 'string' ? l.textContent?.includes(label) : label.test(l.textContent ?? ''))!.querySelector('input[type=checkbox]') as HTMLInputElement;
const writes = () => fetchMock.mock.calls.filter(([, init]) => init && init.method && init.method !== 'GET');
const body = (index = 0) => JSON.parse(writes()[index]![1].body);

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => init?.method && init.method !== 'GET' ? json({}) : json({ links: [link()], page: 1, hasMore: false }));
  vi.stubGlobal('fetch', fetchMock);
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('creating a link', () => {
  it('needs a ticked channel and an acknowledgement before anything is sent, and never shows protocol phrases', async () => {
    await mount(); await click(button('New share link'));
    await type(field('Title'), 'Summer');
    const create = button('Create link');
    expect(create.disabled).toBe(true);
    expect(document.body.textContent).toContain('Nothing ticked means nothing is shared');
    await click(checkbox('Bakery page'));
    expect(create.disabled).toBe(true); // still not acknowledged
    await click(checkbox(/I understand that anyone/));
    expect(create.disabled).toBe(false);
    expect(writes()).toHaveLength(0);
    expect(document.body.textContent).not.toMatch(/CREATE SHARE LINK|shl_/);
  });

  it('Select all persists the exact current channel ids and the backend phrase is built internally', async () => {
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => init?.method === 'POST' ? json({ url: 'https://example.test/share/new-secret' }, true) : json({ links: [link()], page: 1, hasMore: false }));
    await mount(); await click(button('New share link'));
    await type(field('Title'), 'Summer');
    await click(button('Select all'));
    expect(document.body.textContent).toContain('3 of 3 selected');
    await click(checkbox(/I understand that anyone/));
    await click(button('Create link'));
    expect(writes()).toHaveLength(1);
    expect(body()).toMatchObject({ kind: 'review', title: 'Summer', targetIds: ['c1', 'c2', 'c3'], confirmation: 'CREATE SHARE LINK Summer' });
    expect(document.body.textContent).toContain('Copy the address now');
    expect(document.body.textContent).toContain('https://example.test/share/new-secret');
  });

  it('keeps the entered fields and shows the helpful reason when creation fails', async () => {
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => init?.method === 'POST' ? json({ error: 'This workspace has reached its share link limit. Delete old links first.', code: 'conflict' }, false) : json({}));
    await mount(); await click(button('New share link'));
    await type(field('Title'), 'Summer'); await click(checkbox('Shop page')); await click(checkbox(/I understand that anyone/));
    await click(button('Create link'));
    expect(document.body.textContent).toContain('reached its share link limit');
    expect(field('Title').value).toBe('Summer');
    expect(checkbox('Shop page').checked).toBe(true);
    expect(button('Create link').disabled).toBe(false); // can retry
  });
});

describe('editing a link', () => {
  const edit = async (links = [link()]) => { await mount(links); await click(button(/^Edit/)); };

  it('sends a metadata-only edit with the version, without confirmation, and keeps the address', async () => {
    await edit();
    expect(document.body.textContent).not.toContain('replace the link');
    await type(field('Title'), 'Spring campaign v2');
    expect(button('Save changes')).toBeTruthy();
    await click(button('Save changes'));
    expect(body()).toEqual({ title: 'Spring campaign v2', expectedVersion: 'a'.repeat(32) });
    expect(document.body.textContent).toContain('The address is unchanged');
    expect(document.body.textContent).not.toContain('Copy the new address');
  });

  it('warns that access changes replace the address, blocks until acknowledged, and then shows the new address once', async () => {
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => init?.method === 'PATCH' ? json({ rotated: true, url: 'https://example.test/share/rotated-secret' }) : json({ links: [link()], page: 1, hasMore: false }));
    await edit();
    await click(checkbox('Shop page'));
    expect(document.body.textContent).toContain('stop working immediately');
    const save = button('Save and replace address');
    expect(save.disabled).toBe(true);
    await click(checkbox(/old address will stop working/));
    expect(save.disabled).toBe(false);
    expect(writes()).toHaveLength(0);
    await click(save);
    expect(body()).toMatchObject({ targetIds: ['c1', 'c2'], expectedVersion: 'a'.repeat(32), confirmation: 'UPDATE SHARE LINK shl_secret-internal-id' });
    expect(document.body.textContent).toContain('Copy the new address now');
    expect(document.body.textContent).toContain('rotated-secret');
    expect(document.body.textContent).toContain('previous address no longer works');
  });

  it('refuses to untick every channel and does not drop unavailable ones on a metadata edit', async () => {
    await edit([link({ targetIds: ['c1', 'gone'] })]);
    expect(document.body.textContent).toContain('no longer available');
    await type(field('Title'), 'Renamed');
    await click(button('Save changes'));
    expect(body().targetIds).toBeUndefined();
    await click(button(/^Edit/)); // reopen
    await click(checkbox('Bakery page'));
    expect(button(/^Save/).disabled).toBe(true);
  });

  it('keeps edits and offers an explicit reload after a conflict, never overwriting', async () => {
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => init?.method === 'PATCH'
      ? json({ error: 'This link was changed by someone else. Reload it to see the latest settings, then make your change again.', code: 'conflict' }, false)
      : json({ links: [link({ title: 'Changed elsewhere', version: 'b'.repeat(32) })], page: 1, hasMore: false }));
    await edit();
    await type(field('Title'), 'My change');
    await click(button('Save changes'));
    expect(document.body.textContent).toContain('changed by someone else');
    expect(field('Title').value).toBe('My change');
    await click(button(/Reload latest/));
    expect(field('Title').value).toBe('Changed elsewhere');
    await type(field('Title'), 'Changed elsewhere again');
    await click(button('Save changes'));
    expect(writes().at(-1)![1].body).toContain('"expectedVersion":"' + 'b'.repeat(32) + '"');
  });

  it('renews an expired link on purpose through the lifetime field, with acknowledgement', async () => {
    await edit([link({ status: 'expired', expiresAt: new Date(Date.now() - 86_400_000).toISOString() })]);
    expect(document.body.textContent).toContain('has expired');
    await type(field('Renew for'), '14');
    expect(button('Save and replace address').disabled).toBe(true);
    await click(checkbox(/old address will stop working/));
    await click(button('Save and replace address'));
    expect(body()).toMatchObject({ expiresInDays: 14, confirmation: 'UPDATE SHARE LINK shl_secret-internal-id' });
  });

  it('lets a revoked link be renamed only; access fields are disabled so it cannot be reactivated', async () => {
    await edit([link({ status: 'revoked' })]);
    expect(field('Renew for').disabled).toBe(true);
    expect(field('Type').disabled).toBe(true);
    expect(checkbox('Let visitors leave comments').disabled).toBe(true);
    await type(field('Title'), 'Old campaign');
    await click(button('Save changes'));
    expect(body()).toEqual({ title: 'Old campaign', expectedVersion: 'a'.repeat(32) });
  });
});

describe('revoke, rotate and delete', () => {
  it('sends nothing until the consequence is acknowledged, then builds the backend phrase internally', async () => {
    await mount(); await click(button(/^Revoke/));
    expect(document.body.textContent).toContain('Revoke “Spring campaign”');
    expect(document.body.textContent).not.toMatch(/REVOKE SHARE LINK|shl_/);
    const confirm = button('Confirm revoke');
    expect(confirm.disabled).toBe(true);
    await click(confirm); expect(writes()).toHaveLength(0);
    await click(checkbox(/cannot be undone/));
    await click(button('Confirm revoke'));
    expect(body()).toEqual({ action: 'revoke', confirmation: 'REVOKE SHARE LINK shl_secret-internal-id' });
  });

  it('names the exact feedback count that deletion removes and sends nothing before acknowledgement', async () => {
    await mount(); await click(button(/^Delete/));
    expect(document.body.textContent).toContain('2 answers');
    expect(button('Confirm delete').disabled).toBe(true);
    expect(writes()).toHaveLength(0);
    await click(checkbox(/permanently deletes/));
    await click(button('Confirm delete'));
    expect(writes()[0]![1].method).toBe('DELETE');
    expect(body()).toEqual({ confirmation: 'DELETE SHARE LINK shl_secret-internal-id' });
  });

  it('keeps the dialog and shows the failure so the action can be retried', async () => {
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => init?.method === 'POST' ? json({ error: 'Only an active link can be rotated. Create a new link instead.', code: 'conflict' }, false) : json({}));
    await mount(); await click(button(/^Rotate/));
    await click(checkbox(/current address stops working/)); await click(button('Confirm rotate'));
    expect(document.body.textContent).toContain('Only an active link can be rotated');
    expect(button('Confirm rotate').disabled).toBe(false);
  });
});

describe('feedback and customer wording', () => {
  it('says truthfully why a post preview is unavailable and never prints internal ids', async () => {
    fetchMock.mockImplementation(async (url: string) => String(url).includes('/feedback') ? json({ feedback: [{ id: 'd1', decision: 'approved', comment: null, authorName: 'Alex', createdAt: new Date().toISOString(), postStatus: null, postPreview: null }], page: 1, hasMore: false }) : json({}));
    await mount(); await click(button(/answers on|2 answers/));
    expect(document.body.textContent).toContain('Post details are not shown');
    expect(document.body.textContent).toContain('plan cannot read Publishing');
    expect(document.body.textContent).not.toContain('shl_secret-internal-id');
  });

  it('shows a legacy link as covering every channel without giving the editor a blanket selection', async () => {
    await mount([link({ targetIds: [] })]);
    expect(container.textContent).toContain('all channels (older link)');
    await click(button(/^Edit/));
    expect(document.querySelectorAll<HTMLInputElement>('fieldset input[type=checkbox]:checked')).toHaveLength(0);
    await type(field('Title'), 'Renamed legacy');
    await click(button('Save changes'));
    expect(body().targetIds).toBeUndefined();
  });
});
