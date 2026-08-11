import { describe, expect, it } from 'vitest';

import { DEFAULT_PAGE_SIZE, pageHref, pageNumber, paginate } from '../src/lib/paging';

/**
 * Page arithmetic, which is where lists quietly go wrong.
 *
 * Every mistake here has the same shape — a row shown twice, or never — and
 * none of it is visible until somebody has more rows than one page holds,
 * which is exactly when they stop reading carefully.
 */

describe('reading the page number from a URL', () => {
  it('defaults to the first page', () => {
    expect(pageNumber(undefined)).toBe(1);
    expect(pageNumber('')).toBe(1);
  });

  it('refuses anything that is not a page', () => {
    for (const value of ['0', '-3', 'two', '1.5.2', 'NaN']) {
      expect(pageNumber(value), value).toBe(1);
    }
  });

  it('takes the first of a repeated parameter', () => {
    expect(pageNumber(['3', '9'])).toBe(3);
  });
});

describe('working out a page', () => {
  it('covers every row exactly once', () => {
    const total = 96;
    const seen = new Set<number>();

    for (let page = 1; page <= paginate({ total, requested: 1, size: 20 }).pages; page += 1) {
      const result = paginate({ total, requested: page, size: 20 });
      for (let row = result.skip; row < Math.min(result.skip + result.take, total); row += 1) {
        // A row appearing on two pages is the bug this whole file exists for.
        expect(seen.has(row), `row ${row} appears twice`).toBe(false);
        seen.add(row);
      }
    }

    expect(seen.size).toBe(total);
  });

  it('counts pages, including the ragged last one', () => {
    expect(paginate({ total: 96, requested: 1, size: 20 }).pages).toBe(5);
    expect(paginate({ total: 100, requested: 1, size: 20 }).pages).toBe(5);
    expect(paginate({ total: 101, requested: 1, size: 20 }).pages).toBe(6);
  });

  it('keeps one page when there is nothing at all', () => {
    const empty = paginate({ total: 0, requested: 1 });

    expect(empty.pages).toBe(1);
    expect(empty.hasNext).toBe(false);
    expect(empty.from).toBe(0);
    expect(empty.to).toBe(0);
  });

  it('clamps a page past the end to the last one', () => {
    // Somebody bookmarked page nine and posts were deleted since. An empty
    // screen reads as "your posts are gone".
    const result = paginate({ total: 30, requested: 99, size: 20 });

    expect(result.number).toBe(2);
    expect(result.skip).toBe(20);
    expect(result.hasNext).toBe(false);
  });

  it('describes the range in the words a person would use', () => {
    const second = paginate({ total: 96, requested: 2, size: 20 });

    expect([second.from, second.to]).toEqual([21, 40]);

    const last = paginate({ total: 96, requested: 5, size: 20 });
    expect([last.from, last.to]).toEqual([81, 96]);
  });

  it('has a sensible default size', () => {
    expect(paginate({ total: 1000, requested: 1 }).take).toBe(DEFAULT_PAGE_SIZE);
  });
});

describe('the link to another page', () => {
  it('keeps the filters that are already on screen', () => {
    // A Next button that dropped ?status=failed would look like it had jumped
    // somewhere else entirely.
    expect(pageHref('/posts', { status: 'failed' }, 3)).toBe('/posts?status=failed&page=3');
  });

  it('leaves the first page unmarked, so the URL people share is the clean one', () => {
    expect(pageHref('/posts', { status: 'failed' }, 1)).toBe('/posts?status=failed');
    expect(pageHref('/posts', {}, 1)).toBe('/posts');
  });

  it('never carries a stale page number through', () => {
    expect(pageHref('/posts', { page: '7', status: 'draft' }, 2)).toBe('/posts?status=draft&page=2');
  });
});
