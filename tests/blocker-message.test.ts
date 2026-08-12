import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { TARGET_BLOCK_REASONS } from '../src/lib/constants';
import { blockerMessage } from '../src/components/blockerMessage';
import en from '../messages/en.json';
import fr from '../messages/fr.json';

/**
 * Why a destination will not publish, in the reader's language.
 *
 * The reason is decided by a background job that has no idea who will read it,
 * and half this product's audience reads French. Storing the sentence meant a
 * French agency was told in English why a client's Page had stopped working —
 * which is the moment they are least able to guess.
 */
describe('blockerMessage', () => {
  const dictionary = en.connections.blocked as Record<string, string>;
  const translate = (key: string) => dictionary[key.replace('blocked.', '')] ?? key;
  const has = (key: string) => key.replace('blocked.', '') in dictionary;

  it('prefers the translated reason over the stored sentence', () => {
    expect(blockerMessage('role', 'Some English sentence', translate, has)).toBe(dictionary.role);
  });

  it('falls back to the stored sentence for a row written before codes existed', () => {
    // Every destination synced before this column existed has text and no
    // code. Showing nothing would be worse than showing the wrong language.
    expect(blockerMessage(null, 'Stored explanation', translate, has)).toBe('Stored explanation');
  });

  it('falls back when a writer invents a code nobody wrote copy for', () => {
    expect(blockerMessage('not_a_reason', 'Stored explanation', translate, has)).toBe(
      'Stored explanation',
    );
  });

  it('says nothing when there is nothing to say', () => {
    expect(blockerMessage(null, null, translate, has)).toBeNull();
  });
});

describe('the block reasons', () => {
  it('each have words in both languages', () => {
    for (const [language, messages] of [['en', en], ['fr', fr]] as const) {
      const blocked = (messages.connections as { blocked: Record<string, string> }).blocked;
      for (const reason of TARGET_BLOCK_REASONS) {
        expect(blocked[reason], `${language} is missing ${reason}`).toBeTruthy();
      }
    }
  });

  it('are the only codes the writers use', () => {
    // A code written into the database with no matching reason would fall back
    // to English for ever, silently.
    const sources = ['src/lib/accounts.ts', 'src/lib/instagram.ts']
      .map((path) => readFileSync(path, 'utf8'))
      .join('\n');

    const used = [...sources.matchAll(/publishBlockerCode:[^,\n]*'([a-z_]+)'/g)].map(
      (match) => match[1]!,
    );
    expect(used.length, 'no codes are being written at all').toBeGreaterThan(0);
    for (const code of used) {
      expect(TARGET_BLOCK_REASONS as readonly string[]).toContain(code);
    }
  });

  it('are set wherever a blocking sentence is stored', () => {
    // A writer that sets the sentence without a code puts a French user back
    // where they started, and nothing would look wrong.
    for (const path of ['src/lib/accounts.ts', 'src/lib/instagram.ts']) {
      const source = readFileSync(path, 'utf8');
      const sentences = (source.match(/^\s*publishBlocker:/gm) ?? []).length;
      const codes = (source.match(/^\s*publishBlockerCode:/gm) ?? []).length;
      expect(codes, `${path} stores a reason it cannot translate`).toBe(sentences);
    }
  });
});
