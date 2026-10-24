import { describe, expect, it } from 'vitest';
import { intersectResourceScope, parseResourceScope } from '../src/modules/settings/mcp-access/resource-scope';

describe('MCP independent resource ceiling', () => {
  it('keeps a selected key restricted even when its creator is an unrestricted owner', () => {
    expect(intersectResourceScope({ all: true }, { version: 1, mode: 'selected', adAccountIds: [], ids: ['channel-a', 'channel-b'] })).toEqual({ all: false, ids: ['channel-a', 'channel-b'] });
  });
  it('intersects the current membership grant and never expands a selected key', () => {
    expect(intersectResourceScope({ all: false, ids: ['a', 'c'] }, { version: 1, mode: 'selected', adAccountIds: [], ids: ['a', 'b'] })).toEqual({ all: false, ids: ['a'] });
    expect(intersectResourceScope({ all: false, ids: ['a'] }, { version: 1, mode: 'all' })).toEqual({ all: false, ids: ['a'] });
  });
  it('treats an empty selected ceiling as no resources, never all', () => {
    expect(intersectResourceScope({ all: true }, { version: 1, mode: 'selected', adAccountIds: [], ids: [] })).toEqual({ all: false, ids: [] });
  });
  it('preserves legacy NULL scope while refusing missing or malformed stored grants', () => {
    expect(parseResourceScope(null, 10)).toBeNull();
    for (const raw of [undefined, {}, [], {version:2,mode:'all'}, {version:1,mode:'selected'}, {version:1,mode:'selected',ids:['']}, {version:1,mode:'all',ids:['a']}, {version:1,mode:'selected',ids:[1]}]) {
      expect(() => parseResourceScope(raw, 10)).toThrow();
    }
    expect(intersectResourceScope({ all: false, ids: ['a'] }, null)).toEqual({ all: false, ids: ['a'] });
  });
  it('deduplicates a well-formed ceiling and enforces the configured bound', () => {
    expect(parseResourceScope({version:1,mode:'selected',ids:['a','a','b']}, 3)).toEqual({version:1,mode:'selected',ids:['a','b'],adAccountIds:[]});
    expect(() => parseResourceScope({version:1,mode:'selected',ids:['a','b'],adAccountIds:[]}, 1)).toThrow();
    expect(() => parseResourceScope({version:1,mode:'selected',ids:['a'],adAccountIds:['ad-a']}, 1)).toThrow();
    for (const bound of [0,-1,NaN,1.5]) expect(() => parseResourceScope(null,bound)).toThrow();
  });
});
