import { describe, expect, it } from 'vitest';
import { orderTablesForDeletion } from '../src/server/data-control/deletion-order';

const edge = (child: string, parent: string) => ({ child, parent });

describe('workspace erasure table order', () => {
  it('deletes children before parents regardless of alphabetical order', () => {
    const order = orderTablesForDeletion(['a_parent', 'z_child', 'm_mid'], [edge('z_child', 'm_mid'), edge('m_mid', 'a_parent')]);
    expect(order).toEqual(['z_child', 'm_mid', 'a_parent']);
  });
  it('is deterministic and alphabetical when tables are independent', () => {
    expect(orderTablesForDeletion(['c', 'a', 'b', 'a'], [])).toEqual(['a', 'b', 'c']);
  });
  it('ignores self, duplicate and out-of-set edges', () => {
    const order = orderTablesForDeletion(['b', 'a'], [edge('a', 'a'), edge('b', 'a'), edge('b', 'a'), edge('b', 'users'), edge('sessions', 'a')]);
    expect(order).toEqual(['b', 'a']);
  });
  it('handles diamonds', () => {
    const order = orderTablesForDeletion(['root', 'l', 'r', 'leaf'], [edge('l', 'root'), edge('r', 'root'), edge('leaf', 'l'), edge('leaf', 'r')]);
    expect(order.indexOf('leaf')).toBeLessThan(order.indexOf('l'));
    expect(order.indexOf('leaf')).toBeLessThan(order.indexOf('r'));
    expect(order.indexOf('root')).toBe(3);
  });
  it('follows foreign keys through tables outside the set (posts -> feed_items -> feed_sources)', () => {
    // feed_sources sorts before posts; deleting it first would cascade into feed_items and null the still-present posts.
    const dependencies = [edge('posts', 'feed_items'), edge('feed_items', 'feed_sources')];
    const order = orderTablesForDeletion(['feed_sources', 'posts'], dependencies);
    expect(order).toEqual(['posts', 'feed_sources']);
  });
  it('still refuses a cycle that runs through an unlisted table', () => {
    expect(() => orderTablesForDeletion(['a', 'b'], [edge('a', 'hidden'), edge('hidden', 'b'), edge('b', 'a')])).toThrow(/circular/);
  });
  it('refuses cycles rather than guessing', () => {
    expect(() => orderTablesForDeletion(['a', 'b', 'c'], [edge('a', 'b'), edge('b', 'a')])).toThrow(/circular.*a, b/);
  });
  it('treats quote characters in names as inert data', () => {
    expect(orderTablesForDeletion(['x"y', 'a'], [edge('x"y', 'a')])).toEqual(['x"y', 'a']);
  });
});
