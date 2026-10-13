import { expect, it } from 'vitest';
import { nextRadioIndex } from '@/lib/segmented-radio';
it('wraps arrow navigation and supports home/end without trapping Tab', () => {
  expect(nextRadioIndex('ArrowRight', 2, 3)).toBe(0);
  expect(nextRadioIndex('ArrowLeft', 0, 3)).toBe(2);
  expect(nextRadioIndex('ArrowDown', 2, 3)).toBe(0);
  expect(nextRadioIndex('ArrowUp', 0, 3)).toBe(2);
  expect(nextRadioIndex('Home', 2, 3)).toBe(0);
  expect(nextRadioIndex('End', 0, 3)).toBe(2);
  expect(nextRadioIndex('Tab', 0, 3)).toBeNull();
});
it('mirrors horizontal movement in RTL while vertical keys retain order', () => {
  expect(nextRadioIndex('ArrowRight', 0, 3, true)).toBe(2);
  expect(nextRadioIndex('ArrowLeft', 2, 3, true)).toBe(0);
  expect(nextRadioIndex('ArrowDown', 0, 3, true)).toBe(1);
  expect(nextRadioIndex('ArrowRight', 0, 0)).toBeNull();
});
