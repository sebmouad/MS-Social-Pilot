import { beforeEach, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { WEB_APP_DEFAULTS } from '@/modules/settings/web-app/config';
const m = vi.hoisted(() => ({ policy: vi.fn() }));
vi.mock('@/modules/settings/web-app/service', () => ({ publicWebApp: m.policy }));
import { GET as manifest } from '@/app/manifest.webmanifest/route';
import { GET as worker } from '@/app/sw.js/route';
import { GET as offline } from '@/app/offline/route';
import { GET as icon } from '@/app/app-icon/[size]/route';
beforeEach(() => { m.policy.mockResolvedValue(WEB_APP_DEFAULTS); });
it('serves the public manifest in French with no-store policy', async () => {
  const response = await manifest(new Request('https://app.test/manifest.webmanifest?lang=fr'));
  expect(response.headers.get('content-type')).toBe('application/manifest+json'); expect(response.headers.get('cache-control')).toBe('no-store');
  expect(await response.json()).toMatchObject({ description: WEB_APP_DEFAULTS.copy.fr.description, lang: 'fr' });
});
it('Root disable removes the manifest and delivers an unregistering worker rather than leaving an old worker active', async () => {
  m.policy.mockResolvedValue({ ...WEB_APP_DEFAULTS, enabled: false });
  expect((await manifest(new Request('https://app.test/manifest.webmanifest'))).status).toBe(404);
  const response = await worker(); expect(response.headers.get('service-worker-allowed')).toBe('/'); expect(response.headers.get('cache-control')).toBe('no-store');
  expect(await response.text()).toContain('"enabled":false');
});
it('serves a bilingual-selectable offline document with restrictive headers and configured dark/light palettes', async () => {
  const response = await offline(new Request('https://app.test/offline?lang=fr')); const html = await response.text();
  expect(response.headers.get('content-language')).toBe('fr'); expect(response.headers.get('content-security-policy')).toContain("default-src 'none'");
  expect(html).toContain(WEB_APP_DEFAULTS.copy.fr.offlineTitle); expect(html).toContain(WEB_APP_DEFAULTS.darkBackgroundColor);
});
it.each(['192', '512'])('renders an actual %s PNG from Root branding', async size => {
  const response = await icon(new Request('https://app.test/app-icon/' + size), { params: Promise.resolve({ size }) });
  expect(response.headers.get('content-type')).toBe('image/png');
  const metadata = await sharp(Buffer.from(await response.arrayBuffer())).metadata(); expect(metadata).toMatchObject({ width: Number(size), height: Number(size), format: 'png' });
});
it('rejects unadvertised icon dimensions before any image work or Root read', async () => {
  m.policy.mockClear();
  expect((await icon(new Request('https://app.test/app-icon/999999'), { params: Promise.resolve({ size: '999999' }) })).status).toBe(404); expect(m.policy).not.toHaveBeenCalled();
});
