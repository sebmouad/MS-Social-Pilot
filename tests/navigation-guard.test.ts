import { expect, it, vi } from 'vitest';
import { mayLeaveEditor, registerNavigationGuard } from '../src/lib/navigation-guard';
it('uses active editor and old cleanup cannot remove newer guard', async () => {
  const remove = registerNavigationGuard(vi.fn().mockResolvedValue(false));
  expect(await mayLeaveEditor()).toBe(false);
  const removeNext = registerNavigationGuard(vi.fn().mockResolvedValue(true));
  remove();
  expect(await mayLeaveEditor()).toBe(true);
  removeNext();
  expect(await mayLeaveEditor()).toBe(true);
});
