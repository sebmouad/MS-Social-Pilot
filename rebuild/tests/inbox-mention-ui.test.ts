// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MentionTextarea, MentionedBody } from '../src/modules/inbox/components/MentionTextarea';

let root: ReturnType<typeof createRoot>; let container: HTMLDivElement;
const mentionable = [{ id: 'member-b', name: 'Bea' }, { id: 'member-c', name: 'Cal' }];

function Harness({ onChange }: { onChange: (value: string, ids: string[]) => void }) {
  const [value, setValue] = useValue();
  return createElement(MentionTextarea, {
    value, mentionable, listLabel: 'Teammates', emptyLabel: 'Nobody matches.', ariaLabel: 'Private note',
    onChange: (next: string, ids: string[]) => { setValue(next); onChange(next, ids); },
  });
}
import { useState } from 'react';
const useValue = () => useState('');

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

function area() { return container.querySelector('textarea')!; }
function type(text: string) {
  const element = area();
  element.focus();
  const start = element.selectionStart ?? element.value.length;
  const next = element.value.slice(0, start) + text + element.value.slice(element.selectionEnd ?? start);
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!;
  setter.call(element, next);
  element.setSelectionRange(start + text.length, start + text.length);
  element.dispatchEvent(new Event('input', { bubbles: true }));
}
function key(keyName: string, options: KeyboardEventInit = {}) {
  area().dispatchEvent(new KeyboardEvent('keydown', { key: keyName, bubbles: true, cancelable: true, ...options }));
  area().dispatchEvent(new KeyboardEvent('keyup', { key: keyName, bubbles: true, ...options }));
}

describe('mention composer', () => {
  it('opens the teammate list on @ and inserts the picked name', async () => {
    const seen: Array<[string, string[]]> = [];
    await act(async () => root.render(createElement(Harness, { onChange: (value, ids) => seen.push([value, ids]) })));
    await act(async () => { type('Hello @B'); key('b'); });
    expect(container.querySelector('[role="listbox"]')?.textContent).toContain('Bea');
    await act(async () => { key('Enter'); });
    expect(area().value).toBe('Hello @Bea ');
    expect(seen.at(-1)).toEqual(['Hello @Bea ', ['member-b']]);
  });

  it('stops reporting names that leave the text', async () => {
    const seen: Array<[string, string[]]> = [];
    await act(async () => root.render(createElement(Harness, { onChange: (value, ids) => seen.push([value, ids]) })));
    await act(async () => { type('Hi @Bea'); key('a'); });
    await act(async () => { key('Escape'); });
    expect(container.querySelector('[role="listbox"]')).toBeNull();
  });

  it('emphasizes stored mentions in saved notes', async () => {
    await act(async () => root.render(createElement('p', null, createElement(MentionedBody, { body: 'See @Bea and @Cal soon', mentionIds: ['member-b'], mentionable }))));
    expect(container.querySelector('strong')?.textContent).toBe('@Bea');
    expect(container.textContent).toContain('@Cal');
    expect(container.querySelectorAll('strong')).toHaveLength(1);
  });
});
