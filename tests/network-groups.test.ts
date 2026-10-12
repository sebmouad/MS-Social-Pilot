import { describe, expect, it } from 'vitest';

import { groupByNetwork } from '../src/lib/selection';

/** Channel lists are split by platform, Facebook first, each keeping its order. */
describe('groupByNetwork', () => {
  it('groups Pages and Groups under Facebook and the rest by network, in a fixed order', () => {
    const channels = [
      { id: 'a', type: 'pinterest' },
      { id: 'b', type: 'page' },
      { id: 'c', type: 'linkedin' },
      { id: 'd', type: 'group' },
      { id: 'e', type: 'pinterest' },
    ];
    expect(groupByNetwork(channels).map((group) => [group.network, group.items.map((item) => item.id)])).toEqual([
      ['facebook', ['b', 'd']],
      ['linkedin', ['c']],
      ['pinterest', ['a', 'e']],
    ]);
  });

  it('leaves out networks with nothing in them', () => {
    expect(groupByNetwork([])).toEqual([]);
  });
});
