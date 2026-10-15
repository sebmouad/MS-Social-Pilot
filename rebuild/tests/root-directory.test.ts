import { describe, expect, it } from 'vitest';
import { rootDirectoryQuery } from '../src/server/root/directory';

describe('Root directory pagination', () => {
  it('normalizes search and keeps page within safe bounds', () => {
    expect(rootDirectoryQuery({ q: '  Mouad  ', page: '2' }, 25)).toEqual({ query: 'Mouad', page: 2, skip: 25, take: 25 });
    expect(rootDirectoryQuery({ q: ' ', page: '-8' }, 25)).toEqual({ query: '', page: 1, skip: 0, take: 25 });
  });

  it('rejects unsafe page sizes', () => {
    expect(() => rootDirectoryQuery({}, 0)).toThrow(/page size/);
  });
});
