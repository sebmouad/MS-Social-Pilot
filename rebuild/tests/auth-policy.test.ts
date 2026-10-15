import { describe, expect, it } from 'vitest';
import { needsTwoStepEnrollment } from '@/server/auth-policy';

describe('two-step policy', () => {
  it('requires enrollment for workspace owners and admins before channels exist', () => {
    expect(needsTwoStepEnrollment('admins', false, ['owner'])).toBe(true);
    expect(needsTwoStepEnrollment('admins', false, ['admin'])).toBe(true);
    expect(needsTwoStepEnrollment('admins', true, [])).toBe(true);
  });

  it('keeps ordinary members subject to the selected policy', () => {
    expect(needsTwoStepEnrollment('admins', false, ['editor'])).toBe(false);
    expect(needsTwoStepEnrollment('everyone', false, ['viewer'])).toBe(true);
    expect(needsTwoStepEnrollment('off', false, ['owner'])).toBe(false);
  });
});
