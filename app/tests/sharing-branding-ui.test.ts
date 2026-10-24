import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ locale: 'en' as 'en' | 'fr', logo: 'https://images.example.test/logo.png' as string | null }));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('@/modules/home/auth/locale', () => ({ authLocale: async () => state.locale }));
vi.mock('@/server/client-ip', () => ({ clientIpFromHeaders: () => null }));
vi.mock('@/modules/sharing/server/public', () => ({
  resolvePublicLink: async () => ({ ok: true, value: { workspaceName: 'Example studio', workspaceLogoUrl: state.logo, title: 'Client review', kind: 'review', timezone: 'UTC' } }),
  publicMode: () => 'review',
  loadPublicView: async () => ({ posts: [], truncated: false }),
}));
vi.mock('@/modules/sharing/server/limits', async () => {
  const { publicCopy } = await import('@/modules/sharing/ui/copy');
  return { loadPublicCopy: async (locale: 'en' | 'fr') => publicCopy(locale), sharingCopy: async () => ({ intro: '', answerNotice: '', bioFooter: '' }) };
});
import SharePage from '@/modules/sharing/ui/share/token/ShareDetailScreen';
async function html() { return renderToStaticMarkup(await SharePage({ params: Promise.resolve({ token: 'example' }), searchParams: Promise.resolve({}) })); }

describe('public share workspace branding', () => {
  it('renders the authorized logo without leaking the share credential as a referrer', async () => {
    state.locale = 'en'; state.logo = 'https://images.example.test/logo.png';
    const content = await html();
    expect(content).toContain('src="https://images.example.test/logo.png"');
    expect(content).toContain('referrerPolicy="no-referrer"');
    expect(content).toContain('Example studio');
    expect(content).toContain('Nothing to review');
  });
  it('retains workspace identity with no logo and renders French empty state copy', async () => {
    state.locale = 'fr'; state.logo = null;
    const content = await html();
    expect(content).not.toContain('<img');
    expect(content).toContain('Example studio');
    expect(content).toContain('Rien à relire');
  });
});
