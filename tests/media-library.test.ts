import { describe, expect, it, vi } from 'vitest';

/**
 * The Delete button on the media library, and who is shown one.
 *
 * The API is the boundary and is tested separately; this is about what the
 * screen offers. A contributor is refused by the API, so a Delete button in
 * front of them is a button that always fails — which teaches somebody the
 * product is broken rather than that they lack the role.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, refresh: () => {} }),
}));

vi.mock('next-intl', async () => {
  const messages = (await import('../messages/en.json')).default as unknown as Record<
    string,
    Record<string, unknown>
  >;
  return {
    useTranslations: (namespace: string) => (key: string, values?: Record<string, unknown>) => {
      const found = messages[namespace]?.[key];
      if (typeof found !== 'string') return `${namespace}.${key}`;
      // Enough of ICU for these strings: the counts and names, not the plurals.
      return found.replace(/\{(\w+)[^}]*\}/g, (_match, name: string) =>
        String(values?.[name] ?? `{${name}}`),
      );
    },
  };
});

const FREE = {
  id: 'm1',
  filename: 'logo.png',
  kind: 'image' as const,
  size: 2048,
  url: '/api/media/m1/raw',
  uploadedLabel: '3 Aug 2026',
  heldBy: [],
};

const HELD = {
  ...FREE,
  id: 'm2',
  filename: 'launch.png',
  heldBy: [{ id: 'p1', excerpt: 'Launch day' }],
};

async function render(canDelete: boolean): Promise<string> {
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { createElement } = await import('react');
  const { MediaLibrary } = await import('../src/components/MediaLibrary');

  return renderToStaticMarkup(
    createElement(MediaLibrary, {
      files: [FREE, HELD],
      usage: { bytes: 4096, quotaBytes: 1024 * 1024, percent: 1 },
      truncated: false,
      canDelete,
    }),
  );
}

describe('the media library', () => {
  it('offers no Delete button to somebody who may not delete', async () => {
    const markup = await render(false);

    expect(markup).not.toContain('btn-danger');
    // The files themselves are still there: contributors upload and attach
    // them, so hiding the library from them would stop them working.
    expect(markup).toContain('logo.png');
    expect(markup).toContain('launch.png');
  });

  it('offers one to an editor, disabled while a post still needs the file', async () => {
    const markup = await render(true);

    expect(markup.match(/btn-danger/g)).toHaveLength(2);
    const heldButton = markup.slice(markup.indexOf('launch.png'));
    expect(heldButton).toContain('disabled');
  });
});
