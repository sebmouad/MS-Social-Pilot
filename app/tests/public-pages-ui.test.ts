import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SignUpForm } from '../src/app/sign-up/sign-up-form';
import { AuthField } from '../src/modules/home/auth/AuthShell';
import { ReviewActions } from '../src/modules/sharing/ui/share/token/ReviewActions';
import { authCopy } from '../src/modules/home/auth/copy';
import { publicCopy } from '../src/modules/sharing/ui/copy';

describe('sign-up page', () => {
  it('renders the open form on the shared auth frame in English and French', () => {
    const en = renderToStaticMarkup(h(SignUpForm, { open: true, locale: 'en' }));
    const fr = renderToStaticMarkup(h(SignUpForm, { open: true, locale: 'fr' }));
    expect(en.match(/<h1/g)).toHaveLength(1);
    expect(en).toContain('Create your account');
    expect(fr).toContain('Créez votre compte');
    expect(fr).not.toContain('Create your account');
    expect(en).toMatch(/<label[^>]*for="signup-email"/);
    expect(en).toMatch(/<form[^>]*method="post"/);
    expect(en).toMatch(/<form[^>]*novalidate=""/i);
    expect(en).toContain('ui-input');
    expect(en).not.toMatch(/btn-primary|class="card|text-slate/);
  });

  it('explains a closed sign-up with a way back to sign in', () => {
    const closed = renderToStaticMarkup(h(SignUpForm, { open: false, locale: 'fr' }));
    expect(closed).toContain('Les inscriptions sont fermées');
    expect(closed).toContain('href="/sign-in"');
    expect(closed).not.toContain('<form');
  });

  it('has the same copy keys in both languages', () => {
    expect(Object.keys(authCopy('fr').signUp).sort()).toEqual(Object.keys(authCopy('en').signUp).sort());
  });
});

describe('shared auth field', () => {
  it('uses the shared Field: fixed id, help and error wiring', () => {
    const markup = renderToStaticMarkup(h(AuthField, { id: 'x-code', name: 'code', label: 'Code', hint: 'Six digits', error: 'Wrong code' }));
    expect(markup).toMatch(/<label[^>]*for="x-code"/);
    expect(markup).toMatch(/<input[^>]*id="x-code"[^>]*aria-invalid="true"/);
    expect(markup).toContain('Six digits');
    expect(markup).toContain('role="alert"');
  });
});

describe('public share copy', () => {
  it('translates every share, review and bio string', () => {
    const en = publicCopy('en'), fr = publicCopy('fr');
    expect(Object.keys(fr.share).sort()).toEqual(Object.keys(en.share).sort());
    expect(Object.keys(fr.share.statuses).sort()).toEqual(Object.keys(en.share.statuses).sort());
    expect(Object.keys(fr.review).sort()).toEqual(Object.keys(en.review).sort());
    expect(fr.review.approve).toBe('Approuver');
    expect(fr.share.moreFiles(2)).toContain('autres fichiers');
  });

  it('renders the review form with labelled shared fields', () => {
    const markup = renderToStaticMarkup(h(ReviewActions, { token: 't', postId: 'p', canDecide: true, allowComments: true, copy: publicCopy('fr').review }));
    expect(markup).toContain('Votre nom');
    expect(markup).toContain('Approuver');
    expect(markup).toMatch(/<label[^>]*>Commentaire/);
  });
});
