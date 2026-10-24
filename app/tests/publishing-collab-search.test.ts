import { describe, expect, it } from 'vitest';
import { parseCollaborationSearch, parsePostCollaborationSearch } from '../src/modules/publishing/collaboration/search';
const available = ['assign', 'fields'] as const;
describe('organization search scope', () => {
  it('returns explicit defaults and preserves a valid request', () => {
    expect(parseCollaborationSearch({}, available, 20)).toEqual({ view: 'assign', page: 1, q: '' });
    expect(parseCollaborationSearch({ view: 'fields', page: '2', q: ' campaign ' }, available, 20)).toEqual({ view: 'fields', page: 2, q: 'campaign' });
  });
  it.each([{ view: ['assign', 'fields'] }, { page: ['1', '2'] }, { q: ['one', 'two'] }, { view: 'queue' }, { view: 'unknown' }, { unknown: 'x' }, { page: '' }, { page: '0' }, { page: '01' }, { page: '100001' }, { q: 'a\nb' }, { q: 'x'.repeat(21) }])('refuses malformed or unavailable filters rather than widening results: %j', input => {
    expect(() => parseCollaborationSearch(input, available, 20)).toThrow(expect.objectContaining({ code: 'invalid_request' }));
  });
});

describe('post organization paging', () => {
  it('keeps notes and history paging independent', () => {
    expect(parsePostCollaborationSearch({ notesPage: '2', versionsPage: '3' })).toEqual({ notesPage: 2, versionsPage: 3 });
  });
  it.each([{ notesPage: ['1', '2'] }, { versionsPage: '0' }, { unknown: 'x' }])('refuses invalid paging without falling back to the newest page: %j', input => {
    expect(() => parsePostCollaborationSearch(input)).toThrow(expect.objectContaining({ code: 'invalid_request' }));
  });
});
