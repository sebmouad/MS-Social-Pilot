import { describe, expect, it } from 'vitest';

import { brand } from '../src/lib/operator';

describe('brand', () => {
  it('falls back to the product name and no logo before root sets them', () => {
    expect(brand()).toEqual({ name: 'MS Social Pilot', logoUrl: null });
  });
});

describe('changelog entries', () => {
  it('need a date and a title; details are optional', async () => {
    const { changelogSchema } = await import('../src/lib/site');
    expect(changelogSchema.parse({ publishedOn: '2026-10-13', title: ' New inbox ' })).toEqual({ publishedOn: '2026-10-13', title: 'New inbox', body: '' });
    expect(() => changelogSchema.parse({ publishedOn: '13/10/2026', title: 'x' })).toThrow();
    expect(() => changelogSchema.parse({ publishedOn: '2026-10-13', title: '  ' })).toThrow();
  });
});
