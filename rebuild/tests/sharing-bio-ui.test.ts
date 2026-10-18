// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BioManager } from '../src/app/settings/bio/BioManager';

vi.mock('../src/app/settings/sharing/sharing.module.css', () => ({ default: {} }));

const limits = { titleMax: 120, descriptionMax: 500, labelMax: 80, urlMax: 2000 };
const page = (extra: Record<string, unknown> = {}) => ({ slug: 'bakery', title: 'Bakery', description: null, avatarUrl: null, enabled: true, ...extra });
const initialWith = (extra: Record<string, unknown> = {}, links = [{ label: 'Shop', url: 'https://example.test/shop', clicks: 3 }, { label: 'Blog', url: 'https://example.test/blog', clicks: 2 }]) => ({ page: page(), links, limits: { maxLinks: 10 }, ...extra });
const json = (body: unknown, ok = true) => ({ ok, json: async () => body });

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let fetchMock: ReturnType<typeof vi.fn>;
async function mount(initial: unknown = initialWith()) {
  await act(async () => root.render(createElement(BioManager, { initial, limits } as never)));
}
const button = (text: string | RegExp) => [...document.querySelectorAll('button')].find(b => typeof text === 'string' ? b.textContent === text : text.test(b.textContent ?? ''))!;
const click = (el: Element) => act(async () => { (el as HTMLElement).click(); });
async function type(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => { Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })); });
}
const field = (label: string) => [...document.querySelectorAll('label')].find(l => l.textContent?.startsWith(label))!.querySelector('input,textarea') as HTMLInputElement;
const checkbox = (label: string | RegExp) => [...document.querySelectorAll<HTMLLabelElement>('label')].find(l => typeof label === 'string' ? l.textContent?.includes(label) : label.test(l.textContent ?? ''))!.querySelector('input[type=checkbox]') as HTMLInputElement;
const writes = () => fetchMock.mock.calls.filter(([, init]) => init && init.method && init.method !== 'GET');
const body = (index = 0) => JSON.parse(writes()[index]![1].body);
const submitForm = () => act(async () => { document.querySelector('form')!.requestSubmit(); });

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  fetchMock = vi.fn(async () => json({}));
  vi.stubGlobal('fetch', fetchMock);
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('saving the bio page', () => {
  it('sends nothing until the consequence is acknowledged and never shows protocol phrases', async () => {
    await mount();
    const save = button('Save bio page');
    expect(save.disabled).toBe(true);
    expect(document.body.textContent).not.toMatch(/SAVE BIO PAGE|Type this confirmation/);
    expect(document.body.textContent).toMatch(/anyone with the address/i);
    await submitForm();
    expect(writes()).toHaveLength(0);
    await click(checkbox(/I understand/));
    expect(save.disabled).toBe(false);
    expect(writes()).toHaveLength(0);
  });

  it('builds the unchanged backend confirmation internally from the cleaned address', async () => {
    fetchMock.mockImplementation(async () => json({ slug: 'summer-shop' }));
    await mount();
    await type(field('Address'), '  Summer-Shop ');
    await click(checkbox(/I understand/));
    await click(button('Save bio page'));
    expect(writes()).toHaveLength(1);
    expect(writes()[0]![1].method).toBe('PUT');
    expect(body()).toEqual({
      slug: 'summer-shop', title: 'Bakery', description: null, avatarUrl: null, enabled: true,
      links: [{ label: 'Shop', url: 'https://example.test/shop' }, { label: 'Blog', url: 'https://example.test/blog' }],
      confirmation: 'SAVE BIO PAGE summer-shop',
    });
    expect(document.body.textContent).toContain('/bio/summer-shop');
    expect(button('Save bio page').disabled).toBe(true); // consent is per save
  });

  it('describes what changes when the page is public, switched off, or moved to a new address', async () => {
    await mount();
    expect(document.body.textContent).toMatch(/anyone with the address/i);
    await click(checkbox('Page is public'));
    expect(document.body.textContent).toMatch(/visitors will not be able to open/i);
    expect(document.body.textContent).not.toMatch(/anyone with the address/i);
    await click(checkbox('Page is public'));
    await type(field('Address'), 'new-name');
    expect(document.body.textContent).toMatch(/current address .*stops working/i);
  });

  it('withdraws consent when the public setting or address changes after it was given', async () => {
    await mount();
    await click(checkbox(/I understand/));
    expect(button('Save bio page').disabled).toBe(false);
    await click(checkbox('Page is public'));
    expect(checkbox(/I understand/).checked).toBe(false);
    expect(button('Save bio page').disabled).toBe(true);
  });

  it('keeps every entered value and the consent after a failure so it can be retried', async () => {
    fetchMock.mockImplementation(async () => json({ error: 'That address is already taken. Choose another.' }, false));
    await mount(initialWith({ page: null }, []));
    expect(document.body.textContent).toContain('No bio page yet');
    await type(field('Address'), 'taken'); await type(field('Title'), 'My page'); await type(field('Description'), 'Hello');
    await click(button('Add link'));
    await type(field('Label'), 'Shop'); await type([...document.querySelectorAll('label')].filter(l => l.textContent?.startsWith('Address'))[1]!.querySelector('input')!, 'https://example.test/s');
    await click(checkbox(/I understand/));
    await click(button('Save bio page'));
    expect(document.body.textContent).toContain('already taken');
    expect(document.querySelector('[role=alert]')).toBeTruthy();
    expect(field('Title').value).toBe('My page');
    expect(field('Description').value).toBe('Hello');
    expect(field('Label').value).toBe('Shop');
    expect(checkbox(/I understand/).checked).toBe(true);
    expect(button('Save bio page').disabled).toBe(false);
  });

  it('reports an unconfirmed result when the saved address does not match, without claiming success', async () => {
    fetchMock.mockImplementation(async () => json({ slug: 'different' }));
    await mount();
    await click(checkbox(/I understand/)); await click(button('Save bio page'));
    expect(document.body.textContent).toContain('could not be confirmed');
    expect(document.body.textContent).not.toMatch(/Saved\./);
  });

  it('blocks a second submit while one is in flight', async () => {
    let release!: (value: unknown) => void;
    fetchMock.mockImplementation(() => new Promise(resolve => { release = resolve; }));
    await mount();
    await click(checkbox(/I understand/));
    await submitForm(); await submitForm();
    expect(writes()).toHaveLength(1);
    expect(button('Working…').disabled).toBe(true);
    expect(field('Title').disabled).toBe(true);
    await act(async () => release(json({ slug: 'bakery' })));
    expect(writes()).toHaveLength(1);
  });

  it('pauses editing and cannot send when the key only shows part of the links', async () => {
    await mount(initialWith({ truncated: true }));
    expect(document.querySelector('[role=alert]')!.textContent).toContain('only part of this page');
    await click(checkbox(/I understand/));
    expect(button('Save bio page').disabled).toBe(true);
    await submitForm();
    expect(writes()).toHaveLength(0);
  });
});

describe('deleting the bio page', () => {
  it('names the real consequences, sends nothing before consent, then builds the phrase internally', async () => {
    fetchMock.mockImplementation(async () => json({ deleted: true }));
    await mount(); await click(button('Delete page'));
    expect(document.body.textContent).toMatch(/2 links/);
    expect(document.body.textContent).toMatch(/5 counted clicks/);
    expect(document.body.textContent).not.toMatch(/DELETE BIO PAGE|Type to confirm/);
    const confirm = button('Confirm delete');
    expect(confirm.disabled).toBe(true);
    await click(confirm);
    expect(writes()).toHaveLength(0);
    await click(checkbox(/permanently/));
    await click(button('Confirm delete'));
    expect(writes()[0]![1].method).toBe('DELETE');
    expect(body()).toEqual({ confirmation: 'DELETE BIO PAGE bakery' });
    expect(document.body.textContent).toContain('Bio page deleted');
    expect(document.querySelector('dialog[open]')).toBeNull();
    expect(document.body.textContent).toContain('No bio page yet');
  });

  it('keeps the dialog and consent after a failure and recovers on retry', async () => {
    fetchMock.mockImplementationOnce(async () => json({ error: 'The page is locked. Try again shortly.' }, false)).mockImplementation(async () => json({ deleted: true }));
    await mount(); await click(button('Delete page'));
    await click(checkbox(/permanently/)); await click(button('Confirm delete'));
    expect(document.querySelector('dialog')!.textContent).toContain('page is locked');
    expect(checkbox(/permanently/).checked).toBe(true);
    expect(button('Confirm delete').disabled).toBe(false);
    await click(button('Confirm delete'));
    expect(writes()).toHaveLength(2);
    expect(document.body.textContent).toContain('Bio page deleted');
  });

  it('requires fresh consent after cancelling and reopening', async () => {
    await mount(); await click(button('Delete page'));
    await click(checkbox(/permanently/));
    await click(button('Cancel'));
    await click(button('Delete page'));
    expect(checkbox(/permanently/).checked).toBe(false);
    expect(button('Confirm delete').disabled).toBe(true);
    expect(writes()).toHaveLength(0);
  });
});
