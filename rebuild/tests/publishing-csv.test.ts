import { describe, expect, it } from 'vitest';
import { parsePublishingCsv } from '@/modules/publishing/server/lifecycle';
import { csvDestinationLabel, resolveCsvDestinationIds } from '../src/lib/publishing/csv-destinations';

describe('publishing CSV parser', () => {
  it('keeps commas, escaped quotes, and line breaks inside quoted cells', () => {
    expect(parsePublishingCsv('message,firstComment,channels\n"Hello, team","She said ""go""\nnow",page-1;page-2')).toEqual([
      ['message', 'firstComment', 'channels'],
      ['Hello, team', 'She said "go"\nnow', 'page-1;page-2'],
    ]);
  });

  it('ignores blank rows and rejects malformed quoted fields', () => {
    expect(parsePublishingCsv('message,firstComment,channels\n\nPost,,page-1\n')).toEqual([
      ['message', 'firstComment', 'channels'], ['Post', '', 'page-1'],
    ]);
    expect(() => parsePublishingCsv('message,firstComment,channels\n"unfinished,,page-1')).toThrow(/unclosed/);
    expect(() => parsePublishingCsv('message,firstComment,channels\n"quoted"oops,,page-1')).toThrow(/after a closing quote/);
  });
});


describe('publishing CSV destinations', () => {
  const targets = [
    { id: 'private-1', provider: 'facebook', type: 'page', name: 'North Office' },
    { id: 'private-2', provider: 'facebook', type: 'page', name: 'South Office' },
  ];

  it('resolves readable labels without exposing database IDs', () => {
    expect(csvDestinationLabel(targets[0]!)).toBe('facebook / page / North Office');
    expect(resolveCsvDestinationIds('FACEBOOK / PAGE / NORTH OFFICE; facebook / page / South Office', targets, 2)).toEqual(['private-1', 'private-2']);
    expect(resolveCsvDestinationIds('', targets, 2)).toEqual([]);
  });

  it('rejects unavailable and ambiguous destinations', () => {
    expect(() => resolveCsvDestinationIds('facebook / page / Missing', targets, 3)).toThrow(/row 3.*unavailable/);
    expect(() => resolveCsvDestinationIds('facebook / page / North Office', [...targets, { ...targets[0]!, id: 'private-3' }], 4)).toThrow(/row 4.*ambiguous/);
  });
});
