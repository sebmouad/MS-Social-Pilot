import { describe, expect, it, vi } from 'vitest';

/**
 * What the browser gets *before* React runs.
 *
 * Every other test of this form would need a hydrated browser; this one wants
 * the opposite. The markup below is exactly what a visitor sees during the gap
 * between the page arriving and the JavaScript being ready, and what they can
 * do in that gap is the whole subject.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, refresh: () => {} }),
}));

vi.mock('next-intl', async () => {
  const messages = (await import('../messages/en.json')).default as unknown as Record<
    string,
    Record<string, string>
  >;
  return {
    useTranslations: (namespace: string) => (key: string) =>
      messages[namespace]?.[key] ?? `${namespace}.${key}`,
  };
});

async function renderForm(mode: 'login' | 'register'): Promise<string> {
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { createElement } = await import('react');
  const { AuthForm } = await import('../src/components/AuthForm');

  return renderToStaticMarkup(createElement(AuthForm, { mode }));
}

describe('the sign-in form before the JavaScript arrives', () => {
  it('cannot be submitted', async () => {
    const html = await renderForm('register');

    // Not decoration: an enabled button submits the form natively, and a
    // disabled one also blocks the Enter key, because implicit submission is
    // defined as a click on the default button.
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*disabled/);
  });

  it('is marked POST, so a submission that slips through carries nothing in the URL', async () => {
    for (const mode of ['login', 'register'] as const) {
      const html = await renderForm(mode);
      expect(html, mode).toMatch(/<form[^>]*method="post"/);
    }
  });

  it('still asks for everything the account needs', async () => {
    const html = await renderForm('register');

    for (const field of ['name', 'email', 'password', 'workspaceName']) {
      expect(html, field).toContain(`name="${field}"`);
    }

    // The password field must never be a plain text input, disabled button or
    // not — the value is on screen and in the browser's autofill either way.
    expect(html).toMatch(/id="password"[^>]*type="password"|type="password"[^>]*id="password"/);
  });

  it('does not ask a returning visitor to name a workspace', async () => {
    const html = await renderForm('login');

    expect(html).not.toContain('name="workspaceName"');
    expect(html).toContain('name="email"');
  });
});
