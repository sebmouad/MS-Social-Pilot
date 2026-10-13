import { describe, expect, it } from 'vitest';

import { brand } from '../src/lib/operator';

describe('brand', () => {
  it('falls back to the product name and no logo before root sets them', () => {
    expect(brand()).toEqual({ name: 'MS Social Pilot', logoUrl: null });
  });
});
