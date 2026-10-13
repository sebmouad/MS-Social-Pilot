import type { KeyboardEvent } from 'react';

/** Arrow keys move focus and selection together; disabled choices are skipped. */
export function nextRadioIndex(key: string, index: number, length: number, rtl = false): number | null {
  if (length <= 0) return null;
  if (key === 'Home') return 0;
  if (key === 'End') return length - 1;
  if (key === 'ArrowDown') return (index + 1) % length;
  if (key === 'ArrowUp') return (index - 1 + length) % length;
  if (key === 'ArrowRight') return (index + (rtl ? -1 : 1) + length) % length;
  if (key === 'ArrowLeft') return (index + (rtl ? 1 : -1) + length) % length;
  return null;
}
export function onRadioGroupKeyDown(event: KeyboardEvent<HTMLElement>): void {
  const options = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]')).filter(option => !option.disabled && option.getAttribute('aria-disabled') !== 'true');
  const current = options.findIndex(option => option === event.target);
  if (current < 0) return;
  const next = nextRadioIndex(event.key, current, options.length, getComputedStyle(event.currentTarget).direction === 'rtl');
  if (next === null) return;
  event.preventDefault();
  options[next]?.focus();
  options[next]?.click();
}
