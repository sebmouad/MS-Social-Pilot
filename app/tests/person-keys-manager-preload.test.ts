// @vitest-environment jsdom
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PersonKeysManager } from '../src/modules/settings/person-keys/Manager';
import { personKeyCopy } from '../src/modules/settings/person-keys/copy';

const directory = { keys: [], truncated: false, policy: { nameMaxLength: 100, maxLifetimeDays: 90 } };

describe('account person key manager initial state', () => {
  it('renders a server-read directory immediately, without a loading state', () => {
    const html = renderToStaticMarkup(createElement(PersonKeysManager, { locale: 'en', initial: directory }));
    expect(html).toContain('value="90"');
    expect(html).toContain(personKeyCopy.en.empty);
    expect(html).not.toContain(personKeyCopy.en.loading);
  });
  it('shows a retry, not a loading state, when the server read failed', () => {
    const html = renderToStaticMarkup(createElement(PersonKeysManager, { locale: 'fr', initial: null }));
    expect(html).toContain(personKeyCopy.fr.failed);
    expect(html).toContain(personKeyCopy.fr.retry);
    expect(html).not.toContain(personKeyCopy.fr.loading);
  });
  it('still loads in the browser when no initial value is supplied', () => {
    expect(renderToStaticMarkup(createElement(PersonKeysManager, { locale: 'en' }))).toContain(personKeyCopy.en.loading);
  });
});
