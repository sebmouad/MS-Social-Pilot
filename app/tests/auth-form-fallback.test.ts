import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SignInForm } from '../src/app/sign-in/sign-in-form';
import { VerifyForm } from '../src/app/two-step/verify-form';

describe('authentication form fallback', () => {
  it('never falls back to a GET request that could put credentials in the URL', () => {
    for (const markup of [renderToStaticMarkup(createElement(SignInForm, { locale: 'en' })), renderToStaticMarkup(createElement(VerifyForm, { hasPasskey: false, locale: 'en' }))]) {
      expect(markup).toMatch(/<form[^>]*method="post"/);
      expect(markup).toMatch(/<form[^>]*novalidate=""/i);
    }
  });

  it('renders one heading per signed-out page, in the requested language', () => {
    const english = renderToStaticMarkup(createElement(SignInForm, { locale: 'en' }));
    const french = renderToStaticMarkup(createElement(SignInForm, { locale: 'fr' }));
    expect(english.match(/<h1/g)).toHaveLength(1);
    expect(english).toContain('Sign in to your workspace');
    expect(french).toContain('Connectez-vous à votre espace');
    expect(french).not.toContain('Sign in to your workspace');
  });

  it('offers a passkey only when one is enrolled, and labels the code field', () => {
    const without = renderToStaticMarkup(createElement(VerifyForm, { hasPasskey: false, locale: 'en' }));
    const withPasskey = renderToStaticMarkup(createElement(VerifyForm, { hasPasskey: true, locale: 'fr' }));
    expect(without).not.toContain('passkey</button>');
    expect(withPasskey).toContain('Utiliser une clé d’accès');
    expect(withPasskey).toMatch(/<label[^>]*for="two-step-code"/);
  });
});
