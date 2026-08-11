import { describe, expect, it } from 'vitest';

import { ACTIVITY_ACTIONS } from '../src/lib/activity';
import en from '../messages/en.json';
import fr from '../messages/fr.json';

/**
 * Every event the app can record has a sentence to show for it.
 *
 * The history screen exists so that somebody running an agency can see who did
 * what. `post.updated` tells them nothing — the whole value is in the
 * translation, so a logged action with no copy behind it is a defect rather
 * than a cosmetic gap. The screen falls back to naming the raw action, and
 * this is what stops that fallback ever being reached.
 */

/**
 * The list itself, not a scan for it.
 *
 * This started as a regex over every `logActivity` call. It missed four
 * actions — two written through a ternary, two with a capital letter after the
 * dot — and so reported copy for them as stale. Typing the parameter moved the
 * question to the compiler, which cannot miss a call site, and left this file
 * to check only the part a compiler cannot: whether somebody wrote the words.
 */
const ACTIONS: readonly string[] = ACTIVITY_ACTIONS;

describe('the activity log', () => {
  it('records a useful number of different things', () => {
    expect(ACTIONS.length).toBeGreaterThan(20);
    expect(ACTIONS).toContain('post.created');
    expect(ACTIONS).toContain('comment.deleted');
  });

  /**
   * The copy is nested rather than flat, because next-intl reads a dot in a
   * key as nesting and refuses a key that contains one. So `post.created` is
   * stored as actions → post → created, which is also how `t()` looks it up.
   * The browser walk found this: a flat key made every page log the error.
   */
  function flatten(actions: Record<string, Record<string, string>>): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [group, entries] of Object.entries(actions)) {
      for (const [name, label] of Object.entries(entries)) out[`${group}.${name}`] = label;
    }
    return out;
  }

  const english = flatten(en.history.actions);
  const french = flatten(fr.history.actions);

  it('has an English sentence for every action', () => {
    expect(
      ACTIONS.filter((action) => !(action in english)),
      'actions with no English copy',
    ).toEqual([]);
  });

  it('has a French sentence for every action', () => {
    expect(
      ACTIONS.filter((action) => !(action in french)),
      'actions with no French copy',
    ).toEqual([]);
  });

  it('has no copy for actions nothing logs', () => {
    // A stale entry is a smaller problem than a missing one, but it is still a
    // sentence nobody will ever read, kept in two languages.
    const stale = Object.keys(english).filter((action) => !ACTIONS.includes(action));
    expect(stale, 'copy for actions that are never logged').toEqual([]);
  });

  it('reads as a sentence following a name', () => {
    // "Wren Halloway edited a post", not "Wren Halloway Post updated". Every
    // one has to start lower-case and be a verb phrase.
    const wrong = Object.entries(english).filter(
      ([, label]) => label[0] !== label[0]?.toLowerCase(),
    );
    expect(wrong.map(([action]) => action)).toEqual([]);
  });

  it('is stored without a dot in any key, which next-intl refuses', () => {
    for (const group of Object.keys(en.history.actions)) {
      expect(group, 'namespace keys cannot contain a dot').not.toContain('.');
      for (const name of Object.keys(en.history.actions[group as keyof typeof en.history.actions])) {
        expect(name, 'namespace keys cannot contain a dot').not.toContain('.');
      }
    }
  });
});
