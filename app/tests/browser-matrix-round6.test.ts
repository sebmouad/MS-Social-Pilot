// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { focusKeyFor, NO_TABBABLE_AFTER_FOCUS } from '../scripts/verify-browser-matrix';

describe('round 6 keyboard key per engine', () => {
  it('uses Option+Tab for WebKit on macOS so links and buttons are reachable', () => expect(focusKeyFor('webkit', 'darwin')).toBe('Alt+Tab'));
  it('uses plain Tab everywhere else', () => {
    expect(focusKeyFor('webkit', 'linux')).toBe('Tab');
    expect(focusKeyFor('firefox', 'darwin')).toBe('Tab');
    expect(focusKeyFor('chromium', 'darwin')).toBe('Tab');
  });
});

describe('round 6 end-of-tab-order detection', () => {
  const run = (html: string, focus: string) => {
    document.body.innerHTML = html;
    const target = document.querySelector<HTMLElement>(focus)!;
    target.focus();
    // jsdom has no layout: give every element a box so the visibility test sees it.
    document.querySelectorAll('*').forEach(el => { (el as HTMLElement).getBoundingClientRect = () => ({ width: 10, height: 10, top: 0, left: 0, right: 10, bottom: 10, x: 0, y: 0, toJSON() {} }); });
    return eval(NO_TABBABLE_AFTER_FOCUS) as boolean;
  };
  it('is the end when nothing tabbable follows', () => expect(run('<a href="#a" id="a">a</a><button id="b">b</button>', '#b')).toBe(true));
  it('is not the end while a control follows', () => expect(run('<button id="a">a</button><button id="b">b</button>', '#a')).toBe(false));
  it('ignores disabled controls and tabindex -1 after the focus', () => expect(run('<button id="a">a</button><button disabled>b</button><div tabindex="-1">c</div>', '#a')).toBe(true));
  it('ignores controls inside a closed details but not its summary', () => {
    expect(run('<button id="a">a</button><details><summary>s</summary><a href="#x">x</a></details>', '#a')).toBe(false);
    expect(run('<details><summary id="s">s</summary><a href="#x">x</a></details>', '#s')).toBe(true);
  });
  it('sees controls inside an open details', () => expect(run('<details open><summary id="s">s</summary><a href="#x">x</a></details>', '#s')).toBe(false));
});
