// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PostVariantsEditor } from '@/modules/publishing/ui/compose/PostVariantsEditor';
const fetcher = vi.fn();
let root: ReturnType<typeof createRoot>, container: HTMLDivElement;
const listing = {
  postId: 'post-a', defaultMessage: 'Hello', workspaceLocale: 'en',
  variants: [{ locale: 'fr', message: 'Bonjour' }],
  destinations: [
    { targetId: 'target-a', name: 'Page FR', effectiveLocale: 'fr-CA', variantLocale: 'fr', message: 'Bonjour' },
    { targetId: 'target-b', name: 'Page EN', effectiveLocale: 'en', variantLocale: null, message: 'Hello' },
  ],
};
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal('fetch', fetcher); fetcher.mockReset();
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
async function render(postId = 'post-a', locale: 'en' | 'fr' = 'en') {
  await act(async () => root.render(createElement(PostVariantsEditor, { postId, locale })));
  await act(async () => {});
}
function input(selector: string) { return container.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!; }
async function change(selector: string, value: string) {
  const field = input(selector);
  await act(async () => {
    Object.getOwnPropertyDescriptor(field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value')!.set!.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true })); field.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
async function click(label: string) {
  const button = [...container.querySelectorAll('button')].find(el => el.textContent === label)!;
  await act(async () => button.click());
}
it('shows variants and what each destination receives', async () => {
  fetcher.mockResolvedValue({ ok: true, json: async () => listing });
  await render();
  expect(container.textContent).toContain('Bonjour');
  expect(container.textContent).toContain('Page FR');
  expect(container.textContent).toContain('Uses fr');
  expect(container.textContent).toContain('Default text');
  expect(String(fetcher.mock.calls[0]![0])).toBe('/api/publishing/post-variants?postId=post-a');
});
it('saves a language only after the exact typed confirmation', async () => {
  fetcher.mockResolvedValue({ ok: true, json: async () => ({ ok: true, ...listing }) });
  await render();
  await change('input[name=variant-locale]', 'es');
  await change('textarea[name=variant-message]', 'Hola');
  await click('Save language');
  expect(container.querySelector('dialog')).not.toBeNull();
  await change('dialog input', 'ADD VARIANT post-a es');
  await click('Confirm');
  await act(async () => {});
  const posted = fetcher.mock.calls.find(call => (call[1] as RequestInit | undefined)?.method === 'POST')!;
  expect(JSON.parse(posted[1]!.body as string)).toEqual({ action: 'add', postId: 'post-a', locale: 'es', message: 'Hola', confirmation: 'ADD VARIANT post-a es' });
  expect(container.textContent).toContain('Language saved.');
});
it('renders French copy and an honest error state', async () => {
  fetcher.mockResolvedValueOnce({ ok: true, json: async () => ({ ...listing, variants: [] }) });
  await render('post-a', 'fr');
  expect(container.textContent).toContain('Aucune autre langue pour le moment.');
  fetcher.mockRejectedValueOnce(new Error('offline'));
  await render('post-b', 'fr');
  expect(container.textContent).toContain('Les langues sont indisponibles.');
});
