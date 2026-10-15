import { describe, expect, it } from 'vitest';
import { formatBudgetMinor, parseBudgetAmount } from '../src/app/ads/budget';

describe('ads budget display and conversion', () => {
  it('converts decimal user amounts to currency minor units', () => {
    expect(parseBudgetAmount('45.67', 'MAD')).toBe(4567);
    expect(parseBudgetAmount('120', 'JPY')).toBe(120);
    expect(parseBudgetAmount('1.25', null)).toBe(125);
  });

  it('rejects amounts beyond a currency precision or safe integer range', () => {
    expect(parseBudgetAmount('45.678', 'MAD')).toBeNull();
    expect(parseBudgetAmount('1.5', 'JPY')).toBeNull();
    expect(parseBudgetAmount('9007199254740992', null)).toBeNull();
  });

  it('formats minor units as an ordinary currency amount', () => {
    expect(formatBudgetMinor(4567, 'MAD')).toContain('45.67');
    expect(formatBudgetMinor(120, 'JPY')).toContain('120');
  });
});
