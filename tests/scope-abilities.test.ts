import { describe, expect, it } from 'vitest';

import { abilitiesOf } from '../src/lib/scope-abilities';

describe('abilitiesOf', () => {
  it('lists only what the installation asks for, in plain words', () => {
    const result = abilitiesOf(['pages_show_list', 'pages_manage_posts'], ['pages_show_list', 'pages_manage_posts']);
    expect(result).toEqual([
      { ability: 'pages', granted: true },
      { ability: 'publish', granted: true },
    ]);
  });

  it('says what reconnecting would add', () => {
    const result = abilitiesOf(['pages_show_list'], ['pages_show_list', 'ads_read']);
    expect(result).toContainEqual({ ability: 'ads', granted: false });
  });
});
