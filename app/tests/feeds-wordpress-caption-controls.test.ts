import { describe, expect, it } from 'vitest';
import { normalizeWordpressCaption } from '@/modules/feeds/wordpress/text';

describe('WordPress caption control bytes', () => {
  it('turns a control byte before French punctuation into a narrow no-break space', () => {
    expect(normalizeWordpressCaption('salade fraîche\u0016: vous le préparez ce soir\u0016?')).toBe('salade fraîche : vous le préparez ce soir ?');
  });
  it('drops other control bytes and keeps newlines and tabs', () => {
    expect(normalizeWordpressCaption('a\u0001b\nc\td\u007F')).toBe('ab\nc\td');
  });
});
