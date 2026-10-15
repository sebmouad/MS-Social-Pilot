import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import SignIn from '../src/app/sign-in/page';
import { VerifyForm } from '../src/app/two-step/verify-form';

describe('authentication form fallback', () => {
  it('never falls back to a GET request that could put credentials in the URL', () => {
    for (const markup of [renderToStaticMarkup(createElement(SignIn)), renderToStaticMarkup(createElement(VerifyForm, { hasPasskey: false }))]) {
      expect(markup).toMatch(/<form[^>]*method="post"/);
      expect(markup).toMatch(/<form[^>]*novalidate=""/i);
    }
  });
});
