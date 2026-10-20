// @vitest-environment jsdom
import { act, createElement as h, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Avatar, AvatarStack, Menu, Select, avatarInitials, avatarSlot, computePopupPlacement } from '../src/components';

const viewport = { width: 1000, height: 700 };

describe('computePopupPlacement', () => {
  it('stays below when it fits', () => {
    expect(computePopupPlacement({ top: 100, bottom: 140 }, { left: 100, right: 300, height: 200 }, viewport)).toEqual({ flip: false, shiftX: 0, maxHeight: 552 });
  });
  it('flips above when it does not fit below and there is more room above', () => {
    const result = computePopupPlacement({ top: 500, bottom: 540 }, { left: 100, right: 300, height: 300 }, viewport);
    expect(result.flip).toBe(true);
    expect(result.maxHeight).toBe(492);
  });
  it('stays below when both sides are tight but below is larger', () => {
    expect(computePopupPlacement({ top: 200, bottom: 240 }, { left: 0, right: 100, height: 900 }, viewport).flip).toBe(false);
  });
  it('shifts left when it overflows the right edge and right when it overflows the left edge', () => {
    expect(computePopupPlacement({ top: 0, bottom: 40 }, { left: 900, right: 1100, height: 100 }, viewport).shiftX).toBe(-108);
    expect(computePopupPlacement({ top: 0, bottom: 40 }, { left: -60, right: 140, height: 100 }, viewport).shiftX).toBe(68);
  });
  it('never returns a max height below a usable minimum', () => {
    expect(computePopupPlacement({ top: 20, bottom: 690 }, { left: 0, right: 10, height: 500 }, viewport).maxHeight).toBe(120);
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
function stubRects(trigger: { top: number; bottom: number }, popup: { left: number; right: number; height: number }) {
  const original = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function (this: Element) {
    const rect = (top: number, bottom: number, left: number, right: number) => ({ top, bottom, left, right, width: right - left, height: bottom - top, x: left, y: top, toJSON: () => ({}) }) as DOMRect;
    if (this.matches('.ui-select__popup, .ui-menu__list')) return rect(trigger.bottom, trigger.bottom + popup.height, popup.left, popup.right);
    return rect(trigger.top, trigger.bottom, 0, 100);
  };
  return () => { Element.prototype.getBoundingClientRect = original; };
}

describe('Select and Menu viewport placement', () => {
  it('flips a Select popup that would run off the bottom of the viewport', async () => {
    const restore = stubRects({ top: 640, bottom: 680 }, { left: 20, right: 220, height: 300 });
    try {
      Object.defineProperty(window, 'innerHeight', { value: 700, configurable: true });
      await render(h(Select, { 'aria-label': 'Channel', value: 'a', onChange: () => {}, options: [{ value: 'a', label: 'Alpha' }, { value: 'b', label: 'Beta' }] }));
      await click(container.querySelector('button[role=combobox]')!);
      const popup = container.querySelector<HTMLElement>('.ui-select__popup')!;
      expect(popup.getAttribute('data-flip')).toBe('top');
      expect(popup.style.getPropertyValue('--ui-max-h')).toBe('632px');
    } finally { restore(); }
  });

  it('leaves a Select popup below the trigger when there is room', async () => {
    const restore = stubRects({ top: 100, bottom: 140 }, { left: 20, right: 220, height: 200 });
    try {
      await render(h(Select, { 'aria-label': 'Channel', value: 'a', onChange: () => {}, options: [{ value: 'a', label: 'Alpha' }] }));
      await click(container.querySelector('button[role=combobox]')!);
      expect(container.querySelector('.ui-select__popup')!.hasAttribute('data-flip')).toBe(false);
    } finally { restore(); }
  });

  it('shifts a Menu list left when it overflows the right edge', async () => {
    const restore = stubRects({ top: 100, bottom: 140 }, { left: 900, right: 1100, height: 120 });
    try {
      Object.defineProperty(document.documentElement, 'clientWidth', { value: 1000, configurable: true });
      await render(h(Menu, { label: 'Actions', items: [{ key: 'a', label: 'Edit', onSelect: () => {} }] }));
      await click(container.querySelector('button[aria-haspopup=menu]')!);
      expect(container.querySelector<HTMLElement>('[role=menu]')!.style.getPropertyValue('--ui-shift-x')).toBe('-108px');
    } finally { restore(); }
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
