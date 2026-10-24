/// <reference types="vite/client" />
import { RAW_ERROR_PATTERN, isNotFound, isRedirect, setSmoke, type SmokeLocale, type SmokeRole } from './smoke-support';
import { describe, expect, it } from 'vitest';
// @ts-expect-error react-dom ships no types for its edge build, which provides the streaming renderer.
import { renderToReadableStream } from 'react-dom/server.edge';

// Every page.tsx under src/app, discovered at build time so a new route is covered automatically.
const loaders = import.meta.glob('../src/app/**/page.tsx') as Record<string, () => Promise<{ default: (props: unknown) => unknown }>>;
const routeOf = (file: string) => file.replace('../src/app', '').replace(/\/page\.tsx$/, '') || '/';
const sampleParams = (route: string) => Object.fromEntries([...route.matchAll(/\[(?:\.\.\.)?(\w+)\]/g)].map(match => [match[1], 'smoke-id']));

const PUBLIC = new Set(['/', '/sign-in', '/sign-up', '/join', '/password-recovery', '/verify-email', '/two-step', '/two-step/enroll', '/no-workspace', '/access-limited', '/data-deletion', '/privacy-policy', '/terms', '/help', '/pricing', '/status', '/changelog', '/oauth/authorize', '/share/[token]/view', '/bio/[slug]/view', '/reports']);
const ROLES: SmokeRole[] = ['anonymous', 'owner', 'member', 'viewer'];
const LOCALES: SmokeLocale[] = ['en', 'fr'];

type Outcome = { kind: 'rendered'; html: string } | { kind: 'redirect'; to: string } | { kind: 'not-found' } | { kind: 'threw'; error: unknown };

async function visit(file: string, role: SmokeRole, locale: SmokeLocale): Promise<Outcome> {
  setSmoke(role, locale);
  const route = routeOf(file);
  const page = (await loaders[file]!()).default;
  try {
    const element = await (page as (props: unknown) => unknown)({ params: Promise.resolve(sampleParams(route)), searchParams: Promise.resolve({}) });
    // Errors thrown while streaming (including redirect()/notFound() inside async children) are
    // captured and re-thrown here so they classify the same way as errors thrown by the page itself.
    let captured: unknown;
    // Render inside the real root layout so the theme/appearance providers exist, as in the app.
    const { default: RootLayout } = await import('../src/app/layout');
    const document = await RootLayout({ children: element as never });
    const stream = await renderToReadableStream(document, { onError: (error: unknown) => { captured ??= error; return ''; } });
    await Promise.race([stream.allReady, new Promise((_, reject) => setTimeout(() => reject(new Error(`render hung: ${route}`)), 20_000))]);
    if (captured) throw captured;
    const html = await new Response(stream).text();
    return { kind: 'rendered', html };
  } catch (error) {
    const to = isRedirect(error);
    if (to) return { kind: 'redirect', to };
    if (isNotFound(error)) return { kind: 'not-found' };
    return { kind: 'threw', error };
  }
}

describe('page smoke', { timeout: 60_000 }, () => {
  const files = Object.keys(loaders).sort();
  it('discovers the page inventory', () => { expect(files.length).toBeGreaterThan(60); });

  for (const file of files) {
    const route = routeOf(file);
    for (const role of ROLES) for (const locale of LOCALES) {
      it(`${route} as ${role} (${locale}) never crashes or leaks raw errors`, async () => {
        const outcome = await visit(file, role, locale);
        if (outcome.kind === 'threw') throw outcome.error;
        if (outcome.kind === 'rendered') expect(outcome.html).not.toMatch(RAW_ERROR_PATTERN);
        if (outcome.kind === 'redirect') expect(['/sign-in', '/access-limited', '/no-workspace', '/home', '/two-step', '/', '/publishing/posts', '/analytics', '/insights', '/root', '/root/operations']).toContain(outcome.to.split('?')[0]);
        // A signed-in owner never bounces to sign-in or access-limited on a customer or Root page.
        if (role === 'owner' && !PUBLIC.has(route)) expect(outcome.kind === 'redirect' ? outcome.to : 'ok').not.toMatch(/^\/(sign-in|access-limited|no-workspace)/);
        if (role === 'anonymous' && !PUBLIC.has(route)) {
          expect(outcome.kind === 'redirect' && outcome.to.startsWith('/sign-in') || outcome.kind === 'not-found').toBe(true);
        }
        if (route.startsWith('/root') && role !== 'owner' && role !== 'anonymous') {
          expect(outcome).toMatchObject({ kind: 'redirect', to: '/access-limited' });
        }
      });
    }
  }
});
