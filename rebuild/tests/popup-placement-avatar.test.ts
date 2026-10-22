// @vitest-environment jsdom
import { act, createElement as h, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Avatar, AvatarStack, Menu, Select, avatarInitials, avatarSlot, placePopover } from '../src/components';

const viewport = { width: 1000, height: 700 };
const anchor = (top: number, bottom: number, left = 100, right = 200) => ({ top, bottom, left, right });

describe('placePopover', () => {
  it('opens below the anchor when it fits', () => {
    expect(placePopover(anchor(100, 140), { width: 200, height: 200 }, viewport)).toEqual({ left: 100, top: 148, maxHeight: 552, flipped: false });
  });
  it('flips above when it does not fit below and there is more room above', () => {
    const result = placePopover(anchor(500, 540), { width: 200, height: 300 }, viewport);
    expect(result.flipped).toBe(true);
    expect(result.maxHeight).toBe(492);
    expect(result.top).toBe(500 - 8 - 300);
  });
  it('stays below when both sides are tight but below is larger', () => {
    expect(placePopover(anchor(200, 240), { width: 100, height: 900 }, viewport).flipped).toBe(false);
  });
  it('aligns to the anchor end and shifts inside the viewport on either edge', () => {
    expect(placePopover(anchor(0, 40, 800, 980), { width: 300, height: 100 }, viewport, 'end').left).toBe(680);
    expect(placePopover(anchor(0, 40, 900, 990), { width: 300, height: 100 }, viewport).left).toBe(692);
    expect(placePopover(anchor(0, 40, -60, 40), { width: 300, height: 100 }, viewport).left).toBe(8);
  });
  it('never returns a max height below a usable minimum', () => {
    expect(placePopover(anchor(20, 690), { width: 10, height: 500 }, viewport).maxHeight).toBe(120);
  });
});

let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
const render = (node: ReactNode) => act(async () => root.render(node));
const click = (target: Element) => act(async () => { (target as HTMLElement).click(); });

/** jsdom has no layout: report fixed rectangles for the trigger and the popup. */
function stubRects(trigger: { top: number; bottom: number }, popup: { width: number; height: number }) {
  const original = Element.prototype.getBoundingClientRect;
  const originalHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight');
  const originalWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');
  Element.prototype.getBoundingClientRect = function (this: Element) {
    return { top: trigger.top, bottom: trigger.bottom, left: 20, right: 120, width: 100, height: trigger.bottom - trigger.top, x: 20, y: trigger.top, toJSON: () => ({}) } as DOMRect;
  };
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get: () => popup.height });
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get: () => popup.width });
  return () => {
    Element.prototype.getBoundingClientRect = original;
    if (originalHeight) Object.defineProperty(HTMLElement.prototype, 'scrollHeight', originalHeight);
    if (originalWidth) Object.defineProperty(HTMLElement.prototype, 'offsetWidth', originalWidth);
  };
}

describe('Select and Menu popover placement', () => {
  it('flips a Select popup that would run off the bottom of the viewport and fixes it to the viewport', async () => {
    const restore = stubRects({ top: 640, bottom: 680 }, { width: 200, height: 300 });
    try {
      Object.defineProperty(window, 'innerHeight', { value: 700, configurable: true });
      await render(h(Select, { 'aria-label': 'Channel', value: 'a', onChange: () => {}, options: [{ value: 'a', label: 'Alpha' }, { value: 'b', label: 'Beta' }] }));
      await click(container.querySelector('button[role=combobox]')!);
      const popup = document.querySelector<HTMLElement>('.ui-select__popup')!;
      expect(popup.getAttribute('data-flip')).toBe('top');
      expect(popup.style.maxHeight).toBe('632px');
      expect(popup.className).toContain('ui-popover');
    } finally { restore(); }
  });

  it('leaves a Select popup below the trigger when there is room', async () => {
    const restore = stubRects({ top: 100, bottom: 140 }, { width: 200, height: 200 });
    try {
      await render(h(Select, { 'aria-label': 'Channel', value: 'a', onChange: () => {}, options: [{ value: 'a', label: 'Alpha' }] }));
      await click(container.querySelector('button[role=combobox]')!);
      expect(document.querySelector('.ui-select__popup')!.hasAttribute('data-flip')).toBe(false);
    } finally { restore(); }
  });

  it('keeps a Menu list inside the right edge of the viewport', async () => {
    const restore = stubRects({ top: 100, bottom: 140 }, { width: 400, height: 120 });
    try {
      Object.defineProperty(document.documentElement, 'clientWidth', { value: 300, configurable: true });
      await render(h(Menu, { label: 'Actions', align: 'start', items: [{ key: 'a', label: 'Edit', onSelect: () => {} }] }));
      await click(container.querySelector('button[aria-haspopup=menu]')!);
      expect(document.querySelector<HTMLElement>('[role=menu]')!.style.left).toBe('8px');
    } finally { restore(); }
  });

  it('closes the Select on an outside press and on Escape, returning focus to the trigger', async () => {
    await render(h(Select, { 'aria-label': 'Channel', value: 'a', onChange: () => {}, options: [{ value: 'a', label: 'Alpha' }] }));
    const trigger = container.querySelector<HTMLButtonElement>('button[role=combobox]')!;
    await click(trigger);
    expect(document.querySelector('.ui-select__popup')).not.toBeNull();
    await act(async () => { document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })); });
    expect(document.querySelector('.ui-select__popup')).toBeNull();
    await click(trigger);
    await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); });
    expect(document.querySelector('.ui-select__popup')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});

describe('Avatar', () => {
  it('derives up to two initials and a stable slot in 1..8', () => {
    expect(avatarInitials('Sara Benali')).toBe('SB');
    expect(avatarInitials('  omar ')).toBe('O');
    expect(avatarInitials('Jean Pierre Dupont')).toBe('JD');
    expect(avatarInitials('')).toBe('?');
    expect(avatarSlot('Sara Benali')).toBe(avatarSlot('Sara Benali'));
    for (const name of ['a', 'Sara', 'Omar', 'Léa', 'x'.repeat(50)]) expect(avatarSlot(name)).toBeGreaterThanOrEqual(1), expect(avatarSlot(name)).toBeLessThanOrEqual(8);
  });

  it('shows initials with an accessible name, or the image when a source exists', async () => {
    await render(h('div', null, h(Avatar, { name: 'Sara Benali' }), h(Avatar, { name: 'Omar', src: 'https://example.test/o.png', decorative: true })));
    const [first, second] = Array.from(container.querySelectorAll('.ui-avatar'));
    expect(first!.getAttribute('role')).toBe('img');
    expect(first!.getAttribute('aria-label')).toBe('Sara Benali');
    expect(first!.textContent).toBe('SB');
    expect(first!.getAttribute('data-slot')).toBe(String(avatarSlot('Sara Benali')));
    expect(second!.getAttribute('aria-hidden')).toBe('true');
    expect(second!.querySelector('img')!.getAttribute('src')).toBe('https://example.test/o.png');
  });

  it('stacks avatars and counts the hidden ones', async () => {
    const people = ['Ana', 'Bo', 'Cy', 'Di', 'Ed', 'Flo'].map(name => ({ name }));
    await render(h(AvatarStack, { people, max: 3 }));
    const group = container.querySelector('[role=group]')!;
    expect(group.getAttribute('aria-label')).toBe('Ana, Bo, Cy, Di, Ed, Flo');
    expect(group.querySelectorAll('.ui-avatar')).toHaveLength(4);
    expect(group.querySelector('.ui-avatar--more')!.textContent).toBe('+3');
  });
});
