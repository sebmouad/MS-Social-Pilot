// Local end-to-end runs only: point Facebook, Instagram and the updater at the local test doubles, through Root's own
// validated save (secrets encrypted as in production).
//   node --import tsx tests/e2e/configure-fake-meta.ts <owner email> <app origin> <fake meta origin>
import { prisma } from '@/server/data';
import { saveRootConfig } from '@/modules/root/server/configuration';
import { INSTAGRAM_POLICY_DEFAULTS } from '@/platforms/instagram/config';

async function main() {
  const [email, app, meta] = process.argv.slice(2);
  if (!/@(127\.0\.0\.1|localhost)[:/]/.test(process.env.DATABASE_URL ?? '') || !app?.startsWith('https://localhost') || !meta?.startsWith('https://localhost')) throw new Error('Local only.');
  const owner = await prisma.user.findUniqueOrThrow({ where: { email: email! } });
  const settings: Record<string, unknown> = {
    'app.publicOrigin': app,
    'meta.appId': '1234567890',
    'meta.appSecret': 'fake-app-secret',
    'meta.oauthRedirectUri': `${app}/api/connections/facebook/callback`,
    'meta.graphBaseUrl': meta,
    'meta.oauthBaseUrl': `${meta}/v25.0`,
    'meta.webhookVerifyToken': 'fake-verify-token',
    'platforms.instagram.enabled': true,
    'instagram.policy': { ...INSTAGRAM_POLICY_DEFAULTS, graphBaseUrl: meta, graphVersion: 'v25.0', pollIntervalMs: 200 },
    'instagram.appSecret': 'fake-app-secret',
    'ads.managementEnabled': true,
    'updates.automatic': true,
    'updates.githubWebhookSecret': 'gh-test-secret',
  };
  for (const [key, value] of Object.entries(settings)) {
    try { await saveRootConfig({ key, value, confirmation: `SET ROOT CONFIG ${key}` }, owner.id); console.log('set', key); }
    catch (error) { console.log('FAILED', key, (error as Error).message); }
  }
  await prisma.$disconnect();
}
void main();
