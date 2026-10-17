/**
 * Read-only operator probe for a separately bundled rebuild Facebook engine.
 * Run ON the authorized legacy host; never copy credentials off that host.
 * See docs/FACEBOOK_REQUEST_SIGNING.md for explicit inputs and limited proof.
 */
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve, join, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';

const output = value => process.stdout.write(`${JSON.stringify(value)}\n`);
const required = key => {
  const value = process.env[key];
  if (!value) throw new Error('Required probe input is missing.');
  return value;
};
const failure = error => ({
  httpStatus: Number.isInteger(error?.status) ? error.status : 0,
  providerCode: Number.isInteger(error?.code) ? error.code : null,
  appSecretProofRequired: /appsecret_proof|app secret proof/i.test(String(error?.message ?? '')),
  invalidToken: /invalid.*(?:access.?token|oauth)|access.?token.*expired/i.test(String(error?.message ?? '')),
});

let database;
try {
  const appRoot = required('MSP_FACEBOOK_PROBE_APP_ROOT');
  const probeDir = required('MSP_FACEBOOK_PROBE_DIR');
  if (!isAbsolute(appRoot) || !isAbsolute(probeDir)) throw new Error('Probe paths must be absolute.');
  const directory = await stat(probeDir);
  if (!directory.isDirectory() || (directory.mode & 0o077)) throw new Error('Probe directory must be private.');
  const bundlePath = join(probeDir, 'socialpilot-facebook-engine49.mjs');
  const bundleHash = createHash('sha256').update(await readFile(bundlePath)).digest('hex');
  if (!/^[a-f0-9]{64}$/.test(required('MSP_FACEBOOK_PROBE_SHA256')) || bundleHash !== process.env.MSP_FACEBOOK_PROBE_SHA256) {
    throw new Error('Engine bundle does not match the reviewed probe input.');
  }
  const require = createRequire(join(resolve(appRoot), 'package.json'));
  const { PrismaClient } = require('@prisma/client');
  const settingsImport = await import(pathToFileURL(join(appRoot, 'src/lib/settings/index.ts')).href);
  const settings = settingsImport.default ?? settingsImport;
  await settings.ensureSettings(); // Loads legacy settings; never saves or changes them.
  const envImport = await import(pathToFileURL(join(appRoot, 'src/lib/env.ts')).href);
  const { env } = envImport.default ?? envImport;
  const cryptoImport = await import(pathToFileURL(join(appRoot, 'src/lib/crypto.ts')).href);
  const { decryptSecret } = cryptoImport.default ?? cryptoImport;
  const config = JSON.parse(await readFile(join(probeDir, 'socialpilot-facebook-defaults49.json'), 'utf8'));
  config.graphBaseUrl = env.graphBaseUrl;
  config.graphVersion = env.graphVersion;
  config.requestTimeoutMs = env.graphTimeoutMs;
  config.appSecret = env.facebookAppSecret;
  const expectedOrigin = new URL(required('MSP_FACEBOOK_PROBE_GRAPH_ORIGIN'));
  const actualEndpoint = new URL(config.graphBaseUrl);
  if (expectedOrigin.protocol !== 'https:' || expectedOrigin.username || expectedOrigin.password
    || expectedOrigin.pathname !== '/' || expectedOrigin.search || expectedOrigin.hash
    || actualEndpoint.origin !== expectedOrigin.origin || actualEndpoint.username || actualEndpoint.password
    || config.appSecretProofEnabled !== true || !config.appSecret) {
    throw new Error('Reviewed endpoint or signing configuration is unavailable.');
  }
  const requiredScopes = config.probeRequiredScopes;
  if (!Array.isArray(requiredScopes) || !requiredScopes.length || requiredScopes.some(scope => typeof scope !== 'string' || !/^[a-z_]+$/.test(scope))) {
    throw new Error('Explicit required read scopes must be supplied.');
  }
  database = new PrismaClient({ log: [] });
  const source = await database.$transaction(async transaction => {
    await transaction.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    return transaction.socialAccount.findFirst({
      where: { provider: 'facebook', invalidatedAt: null, OR: [{ tokenExpiresAt: null }, { tokenExpiresAt: { gt: new Date() } }], targets: { some: { enabled: true, type: 'page', canPublish: true, accessToken: { not: null } } } },
      orderBy: { id: 'asc' },
      select: { providerUserId: true, accessToken: true, targets: { where: { enabled: true, type: 'page', canPublish: true, accessToken: { not: null } }, orderBy: { id: 'asc' }, select: { providerId: true, accessToken: true } } },
    });
  });
  if (!source?.targets.length) throw new Error('No eligible authorized source is available.');
  const { createFacebookEngine } = await import(pathToFileURL(bundlePath).href);
  const engine = createFacebookEngine(config);
  const userToken = decryptSecret(source.accessToken);
  const page = source.targets[0];
  const pageToken = decryptSecret(page.accessToken);
  let passed = 0;
  let total = 0;
  const step = async (name, action) => {
    total++;
    const started = Date.now();
    try {
      const evidence = await action();
      const ok = evidence.ok === true;
      if (ok) passed++;
      output({ check: name, ...evidence, elapsedMs: Date.now() - started });
    } catch (error) {
      output({ check: name, ok: false, ...failure(error), elapsedMs: Date.now() - started });
    }
  };
  output({ probe: 'rebuild-facebook-read49', bundleSha256: bundleHash, graphVersion: config.graphVersion,
    selectedEligiblePages: source.targets.length, signingEnabled: true, providerWrites: false, productionDatabaseWrites: false });
  await step('user_identity', async () => {
    const result = await engine.getCurrentUser(userToken);
    return { ok: result.id === source.providerUserId, identityMatchesStored: result.id === source.providerUserId };
  });
  await step('granted_permissions', async () => {
    const result = await engine.getGrantedPermissions(userToken);
    const missingRequiredScopes = requiredScopes.filter(scope => !result.includes(scope));
    return { ok: missingRequiredScopes.length === 0, count: result.length, missingRequiredScopes,
      adsReadGranted: result.includes('ads_read'), adsManagementGranted: result.includes('ads_management') };
  });
  await step('page_discovery', async () => {
    const result = await engine.discoverPages(userToken);
    return { ok: result.some(item => item.id === page.providerId), discoveredPages: result.length, sampledSelectedPageFound: result.some(item => item.id === page.providerId) };
  });
  await step('ad_account_discovery', async () => {
    const result = await engine.discoverAdAccounts(userToken);
    return { ok: true, discoveredAdAccounts: result.length };
  });
  await step('page_identity', async () => {
    const result = await engine.getCurrentUser(pageToken);
    return { ok: result.id === page.providerId, identityMatchesStored: result.id === page.providerId };
  });
  await step('configured_page_metrics', async () => {
    const until = new Date();
    const since = new Date(until.getTime() - 2 * 24 * 60 * 60 * 1000); // Probe window, not product policy.
    const observations = await engine.getPageInsightObservations(pageToken, page.providerId, since, until);
    const failedMetrics = (observations.failedMetrics ?? []).map(item => item.metric);
    const metricsWithObservations = [...new Set(observations.map(item => item.metric))];
    const metricsWithoutObservations = config.pageInsightMetrics.filter(metric => !metricsWithObservations.includes(metric));
    return { ok: config.pageInsightMetrics.length > 0 && failedMetrics.length === 0 && metricsWithoutObservations.length === 0,
      requestedMetrics: config.pageInsightMetrics.length, observationCount: observations.length,
      metricsWithObservations, metricsWithoutObservations, failedMetrics };
  });
  output({ passedReadChecks: passed, totalReadChecks: total, providerWrites: false, productionDatabaseWrites: false });
  if (passed !== total) process.exitCode = 2;
} catch {
  output({ probe: 'rebuild-facebook-read49', ok: false, reason: 'Probe setup failed; sensitive details withheld.' });
  process.exitCode = 1;
} finally {
  await database?.$disconnect().catch(() => {});
}
