import { describe, expect, it, vi } from 'vitest';
import { decodeWordpressText, normalizeWordpressCaption } from '../src/modules/feeds/wordpress/text';
import entities from '../src/modules/feeds/wordpress/html-entities.json';
import { openWordpressDb, readWordpressCaption } from '../src/modules/feeds/wordpress/db';
import { parseRecipe } from '../src/modules/feeds/wordpress/recipe';

describe('WordPress HTML character references', () => {
  it('preserves both French nonbreaking spaces from literal, decimal, hex and named inputs', () => {
    for (const input of ['\u202f', '&#8239;', '&#x202f;', '&#X202F;']) {
      expect(normalizeWordpressCaption(`salade fraîche${input}: vous le préparez ce soir${input}?`)).toBe('salade fraîche\u202f: vous le préparez ce soir\u202f?');
    }
    for (const input of ['\u00a0', '&nbsp;', '&#160;', '&#xA0;', '&NonBreakingSpace;']) {
      expect(normalizeWordpressCaption(`Prêt${input}!`)).toBe('Prêt\u00a0!');
    }
  });
  it('decodes the complete HTML5 catalog, preserving case and multi-codepoint expansions', () => {
    for (const [name, value] of Object.entries(entities)) expect(decodeWordpressText(`&${name}`), name).toBe(value);
    expect(decodeWordpressText('&Eacute; &eacute; &NotEqualTilde; &CounterClockwiseContourIntegral;')).toBe('É é ≂̸ ∳');
  });
  it('uses HTML numeric replacement rules without turning whitespace into numbers', () => {
    expect(decodeWordpressText('&#128; &#0; &#xD800; &#1114112; &#x1f957;')).toBe('€ � � � 🥗');
    expect(decodeWordpressText('&#32;|&#9;|&#10;|&#8239;')).toBe(' |\t|\n|\u202f');
    expect(decodeWordpressText('&#0000000000008239;')).toBe('\u202f');
  });
  it('leaves unknown references, ordinary numbers, punctuation, line breaks and escaped literal entities intact', () => {
    expect(normalizeWordpressCaption('  10:30\n20 g &unknown; &#xZZ; &#; &amp;nbsp;  ')).toBe('10:30\n20 g &unknown; &#xZZ; &#; &nbsp;');
    expect(decodeWordpressText('&amp &lt &gt &notit;')).toBe('& < > ¬it;');
  });
  it('normalizes recipe text without flattening French punctuation spaces', () => {
    const recipe = parseRecipe(JSON.stringify({ title: 'Salade &eacute;t&eacute;', ingredients: ['Sel&nbsp;: 10 g'], steps: ['Mélangez&#8239;!\n  Servez.'] }), '', ' min');
    expect(recipe).toMatchObject({ title: 'Salade été', ingredients: [{ text: 'Sel\u00a0: 10 g' }], steps: [{ text: 'Mélangez\u202f! Servez.' }] });
  });
});

const settings = { url: 'mysql://reader:password@localhost/wordpress', tablePrefix: 'wp_', connectTimeoutMs: 1000, queryTimeoutMs: 1000, poolSize: 1 };
const mapping = { captionMetaKey: 'caption', imageMetaKey: 'image', recipeMetaKey: 'recipe', skipMetaKey: '', attachedFileMetaKey: 'file', postType: 'post', postStatus: 'publish' };
describe('WordPress caption read boundary', () => {
  it('decodes UTF-8 buffers and entity text before preview/planning receives the candidate', async () => {
    const query = vi.fn(async () => [[{ id: '1', caption: Buffer.from('Salade&#8239;: fraîche&nbsp;?'), title: 'Salade', recipe: '{}', imageId: '2' }], []] as [unknown, unknown]);
    const db = await openWordpressDb(settings, async () => ({ query, end: async () => undefined }));
    expect((await db.candidates({ mapping, order: 'newest', skipShared: false, maxAgeDays: 0, afterId: null, limit: 1, now: new Date() }))[0]?.caption).toBe('Salade\u202f: fraîche\u00a0?');
  });
  it('reads an exact source caption with parameterized identity and closes its pool', async () => {
    const query = vi.fn(async () => [[{ caption: 'Salade&#8239;?' }], []] as [unknown, unknown]);
    const end = vi.fn(async () => undefined);
    expect(await readWordpressCaption(settings, mapping, '123', async () => ({ query, end }))).toBe('Salade&#8239;?');
    expect(query.mock.calls[0]).toEqual([{ sql: expect.stringMatching(/^SELECT DISTINCT/), values: ['123', 'caption', 'post', 'publish'], timeout: 1000 }]);
    expect(end).toHaveBeenCalledOnce();
  });
  it('refuses ambiguous source meta and closes even on read failure', async () => {
    const end = vi.fn(async () => undefined);
    expect(await readWordpressCaption(settings, mapping, '1', async () => ({ query: async () => [[{ caption: 'a' }, { caption: 'b' }], []], end }))).toBeNull();
    await expect(readWordpressCaption(settings, mapping, '1', async () => ({ query: async () => { throw new Error('offline'); }, end }))).rejects.toThrow('offline');
    expect(end).toHaveBeenCalledTimes(2);
  });
});
