/**
 * Explicit, bounded live multi-photo canary for the reviewed Facebook engine.
 *
 * This is an engine-only bridge to legacy credentials, not a rebuild UI/API/MCP
 * or production-journal test. It never writes to the database. The private
 * file journal commits each photo/feed/delete intent and receipt before the
 * engine can continue. Unknown outcomes are retained and never replayed.
 *
 * Run only after review, on the authorized host, from the legacy app root with
 * `node --env-file=.env --import tsx`. Required inputs are documented in the
 * final operator note returned to the parent; no environment values are logged.
 */
import { createHash, randomUUID } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { chmod, lstat, mkdir, open, readFile, readdir, rename, rm, rmdir, unlink } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { deflateSync } from 'node:zlib';

const MAX_REMOTE_ID = 2048;
const CANARY_CAPTION = 'CANARY TEST — temporary multi-photo publishing verification. Please ignore; this post will be removed.';

const output = value => process.stdout.write(`${JSON.stringify(value)}\n`);
let activeLedgerPath;
let activeLockPath;
let activeStage = 'input_preflight';
const required = name => {
  const value = process.env[name];
  if (!value) throw new Error('Required canary input is missing.');
  return value;
};
const safeId = value => typeof value === 'string' && value.length > 0 && value.length <= MAX_REMOTE_ID
  && value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const failure = reason => ({ probe: 'facebook-live-media-canary', ok: false, reason });
const shapeError = () => new Error('Canary preflight failed.');
function safeFailureMetadata(error) {
  const status = Number.isSafeInteger(error?.status) ? error.status : undefined;
  const code = Number.isSafeInteger(error?.code) ? error.code : undefined;
  const subcode = Number.isSafeInteger(error?.subcode) ? error.subcode : undefined;
  return {
    ...(status === undefined ? {} : { httpStatus: status }),
    ...(code === undefined ? {} : { providerCode: code }),
    ...(subcode === undefined ? {} : { providerSubcode: subcode }),
  };
}

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  CRC_TABLE[n] = c >>> 0;
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const name = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}

/** Return a small, deterministic, locally generated RGB PNG (no external asset fetch). */
export function generatePngFixture(variant = 0) {
  const width = 640, height = 480;
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4);
  header[8] = 8; header[9] = 2; // 8-bit truecolor RGB
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1);
    raw[row] = 0; // PNG filter: None
    for (let x = 0; x < width; x++) {
      const offset = row + 1 + x * 3;
      raw[offset] = (x * 5 + variant * 71) & 0xff;
      raw[offset + 1] = (y * 7 + variant * 37) & 0xff;
      raw[offset + 2] = ((x + y) * 3 + variant * 113) & 0xff;
    }
  }
  const bytes = Buffer.concat([PNG_SIGNATURE, pngChunk('IHDR', header), pngChunk('IDAT', deflateSync(raw)), pngChunk('IEND', Buffer.alloc(0))]);
  return { bytes, mimeType: 'image/png', fileName: `msp-canary-${variant + 1}.png` };
}

export function validPngSignature(bytes) {
  return bytes.length >= PNG_SIGNATURE.length && PNG_SIGNATURE.equals(Buffer.from(bytes.subarray(0, PNG_SIGNATURE.length)));
}

async function requirePrivateDirectory(path) {
  if (!isAbsolute(path)) throw shapeError();
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077) !== 0 || info.uid !== process.getuid?.()) throw shapeError();
  return resolve(path);
}

async function readPinnedFile(directory, filename, expectedHash) {
  if (!/^[a-f0-9]{64}$/.test(expectedHash)) throw shapeError();
  const path = join(directory, filename);
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o077) !== 0) throw shapeError();
  const bytes = await readFile(path);
  if (sha256(bytes) !== expectedHash) throw shapeError();
  return { path, bytes };
}

async function assertNoUnresolvedPriorLedger(parentDirectory, pageId) {
  const entries = await readdir(parentDirectory, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const ledgerPath = join(parentDirectory, entry.name, 'run.json');
    let bytes;
    try { bytes = await readFile(ledgerPath); } catch (error) {
      if (error?.code === 'ENOENT') continue;
      throw shapeError();
    }
    let prior;
    try { prior = JSON.parse(bytes.toString('utf8')); } catch { throw shapeError(); }
    if (prior?.remoteTargetId === pageId && !canFinalizeCompletedRun(prior, false)) {
      throw new Error('An earlier canary ledger for this Page remains unresolved; do not run another canary.');
    }
  }
}

async function createRunDirectory(parentDirectory) {
  const path = join(parentDirectory, randomUUID());
  await mkdir(path, { mode: 0o700 });
  await chmod(path, 0o700);
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077) !== 0 || info.uid !== process.getuid?.()) throw shapeError();
  return path;
}

async function syncDirectory(path) {
  const handle = await open(path, fsConstants.O_RDONLY | (fsConstants.O_DIRECTORY ?? 0));
  try { await handle.sync(); } finally { await handle.close(); }
}

async function writeLedger(runDirectory, ledger) {
  const target = join(runDirectory, 'run.json');
  const temporary = join(runDirectory, `run.${randomUUID()}.tmp`);
  const handle = await open(temporary, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | (fsConstants.O_NOFOLLOW ?? 0), 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(ledger, null, 2)}\n`, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, target);
  await syncDirectory(runDirectory);
}

export function createFileJournal(runDirectory, ledger) {
  const save = () => writeLedger(runDirectory, ledger);
  const photos = () => ledger.steps.filter(step => step.phase === 'photo').sort((a, b) => a.ordinal - b.ordinal);
  const active = () => ledger.feed?.state === 'started';
  return (operationId, remoteTargetId) => {
    if (operationId !== ledger.operationId || remoteTargetId !== ledger.remoteTargetId) throw shapeError();
    return {
      async beginPhoto(ordinal) {
        const prior = photos();
        if (!Number.isSafeInteger(ordinal) || ordinal < 1 || ordinal > 2 || ordinal !== prior.length + 1
          || prior.some(step => step.state !== 'recorded') || ledger.feed) throw shapeError();
        ledger.steps.push({ phase: 'photo', ordinal, state: 'started', remoteId: null, cleanup: null });
        await save();
      },
      async recordPhoto(ordinal, remoteId) {
        const row = photos().find(step => step.ordinal === ordinal);
        if (!row || row.state !== 'started' || !safeId(remoteId) || photos().some(step => step.remoteId === remoteId)) throw shapeError();
        row.state = 'recorded'; row.remoteId = remoteId; await save();
      },
      async rejectPhoto(ordinal) {
        const row = photos().find(step => step.ordinal === ordinal);
        if (!row || row.state !== 'started') throw shapeError();
        row.state = 'rejected'; await save();
      },
      async beginFeed(photoIds) {
        const ordered = photos();
        if (ledger.feed || photoIds.length !== 2 || ordered.length !== 2 || ordered.some((step, index) => step.state !== 'recorded' || step.remoteId !== photoIds[index])) throw shapeError();
        ledger.feed = { state: 'started', remoteId: null, cleanup: null }; await save();
      },
      async recordFeed(remoteId) {
        if (!active() || !safeId(remoteId)) throw shapeError();
        ledger.feed.state = 'recorded'; ledger.feed.remoteId = remoteId; await save();
      },
      async rejectFeed() {
        if (!active()) throw shapeError();
        ledger.feed.state = 'rejected'; await save();
      },
    };
  };
}

export function safePhotoState(state, expectedId) {
  if (state?.id !== expectedId || !safeId(state?.id) || state?.can_delete !== true) return false;
  // Absence/null is accepted only under this explicitly acknowledged test;
  // neither value is interpreted as proof that Meta's photo is unattached.
  return !Object.hasOwn(state, 'page_story_id') || state.page_story_id === null;
}

export async function cleanupKnownMedia(engine, pageToken, ledger, runDirectory) {
  ledger.cleanup = ledger.cleanup ?? { status: 'pending', note: null };
  const photoRows = ledger.steps.filter(step => step.phase === 'photo');
  const photos = photoRows.filter(step => step.state === 'recorded' && safeId(step.remoteId));
  const feedState = ledger.feed?.state ?? 'not_started';

  if (feedState === 'started' || feedState === 'uncertain') {
    ledger.cleanup.status = 'held_unknown_feed';
    ledger.cleanup.note = 'Feed intent may have created a post; do not delete staged photos or retry.';
    await writeLedger(runDirectory, ledger);
    return;
  }

  if (feedState === 'recorded') {
    if (!safeId(ledger.feed.remoteId)) {
      ledger.cleanup.status = 'held_missing_feed_id';
      ledger.cleanup.note = 'Feed receipt state lacks a safe remote ID; do not search or retry.';
      await writeLedger(runDirectory, ledger);
      return;
    }
    if (ledger.feed.cleanup?.state !== 'confirmed') {
      if (ledger.feed.cleanup?.state) {
        ledger.cleanup.status = 'held_feed_delete_unknown';
        ledger.cleanup.note = 'Feed deletion already has a prior intent; do not repeat it.';
        await writeLedger(runDirectory, ledger);
        return;
      }
      ledger.feed.cleanup = { state: 'started' };
      await writeLedger(runDirectory, ledger);
      try {
        await engine.deletePost(pageToken, ledger.feed.remoteId);
        ledger.feed.cleanup.state = 'confirmed';
      } catch {
        ledger.feed.cleanup.state = 'uncertain';
        ledger.cleanup.status = 'held_feed_delete_unknown';
        ledger.cleanup.note = 'Feed deletion did not return a confirmed receipt; do not retry.';
        await writeLedger(runDirectory, ledger);
        return;
      }
      await writeLedger(runDirectory, ledger);
    }
  }

  const feedSafeForPhotoDeletion = feedState === 'not_started' || feedState === 'rejected'
    || feedState === 'recorded' && ledger.feed?.cleanup?.state === 'confirmed';
  if (!feedSafeForPhotoDeletion) {
    ledger.cleanup.status = 'held_feed_not_cleared';
    ledger.cleanup.note = 'Feed is not proven absent; do not delete photo IDs.';
    await writeLedger(runDirectory, ledger);
    return;
  }

  let unresolved = photoRows.some(photo => photo.state !== 'recorded' && photo.state !== 'rejected');
  for (const photo of photos) {
    if (photo.cleanup?.state === 'confirmed') continue;
    if (photo.cleanup?.state) { unresolved = true; continue; }
    let state;
    try { state = await engine.getPhotoCleanupState(pageToken, photo.remoteId); }
    catch { photo.cleanup = { state: 'blocked', reason: 'photo_read_unavailable' }; unresolved = true; await writeLedger(runDirectory, ledger); continue; }
    if (!safePhotoState(state, photo.remoteId)) {
      photo.cleanup = { state: 'blocked', reason: state?.page_story_id ? 'still_associated' : 'photo_not_deletable_or_malformed' };
      unresolved = true; await writeLedger(runDirectory, ledger); continue;
    }
    photo.cleanup = { state: 'started' };
    await writeLedger(runDirectory, ledger);
    try {
      await engine.deletePhoto(pageToken, photo.remoteId);
      photo.cleanup.state = 'confirmed';
    } catch {
      photo.cleanup.state = 'uncertain';
      unresolved = true;
    }
    await writeLedger(runDirectory, ledger);
  }

  const allKnownPhotosCleared = photos.every(photo => photo.cleanup?.state === 'confirmed')
    && photoRows.every(photo => photo.state === 'recorded' || photo.state === 'rejected');
  ledger.cleanup.status = allKnownPhotosCleared && !unresolved ? 'complete' : 'held_photo_cleanup';
  ledger.cleanup.note = ledger.cleanup.status === 'complete' ? null : 'Some known staged photo IDs remain unresolved; do not retry or search automatically.';
  await writeLedger(runDirectory, ledger);
}

export async function finalizeCompletedRun(runDirectory, ledgerParent, ledger, publishError = false) {
  if (!canFinalizeCompletedRun(ledger, publishError)) return false;
  const resolvedParent = resolve(ledgerParent);
  const resolvedRun = resolve(runDirectory);
  if (resolve(resolvedRun, '..') !== resolvedParent) throw shapeError();
  const dirInfo = await lstat(resolvedRun);
  if (!dirInfo.isDirectory() || dirInfo.isSymbolicLink() || (dirInfo.mode & 0o077) !== 0 || dirInfo.uid !== process.getuid?.()) throw shapeError();
  const ledgerPath = join(resolvedRun, 'run.json');
  const stored = JSON.parse(await readFile(ledgerPath, 'utf8'));
  if (stored?.operationId !== ledger.operationId || stored?.remoteTargetId !== ledger.remoteTargetId
    || stored?.cleanup?.status !== 'complete') throw shapeError();
  await rm(ledgerPath, { force: false });
  await syncDirectory(resolvedRun);
  await rmdir(resolvedRun);
  await syncDirectory(resolvedParent);
  return true;
}

export function canFinalizeCompletedRun(ledger, publishError = false) {
  const photoRows = ledger.steps.filter(step => step.phase === 'photo');
  return !publishError
    && ledger.cleanup?.status === 'complete'
    && ledger.feed?.state === 'recorded' && safeId(ledger.feed.remoteId)
    && ledger.feed.cleanup?.state === 'confirmed'
    && photoRows.length === 2
    && photoRows.every(photo => photo.state === 'recorded' && safeId(photo.remoteId) && photo.cleanup?.state === 'confirmed')
    && ledger.verification?.feedPublished === true
    && ledger.verification?.photoAssociation === true;
}

export async function acquirePageLock(ledgerParent, pageId) {
  if (!safeId(pageId)) throw shapeError();
  const parent = await requirePrivateDirectory(ledgerParent);
  const path = join(parent, `page-${sha256(Buffer.from(pageId, 'utf8'))}.lock`);
  const nonce = randomUUID();
  let handle;
  try {
    handle = await open(path, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | (fsConstants.O_NOFOLLOW ?? 0), 0o600);
  } catch { throw new Error('A canary lock exists for this Page; inspect its private ledger and do not start another run.'); }
  try {
    await handle.writeFile(`${JSON.stringify({ pageId, nonce })}\n`, 'utf8');
    await handle.sync();
  } finally { await handle.close(); }
  await syncDirectory(parent);
  return { path, parent, pageId, nonce };
}

export async function releasePageLock(lock) {
  const info = await lstat(lock.path);
  if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o077) !== 0 || info.uid !== process.getuid?.()) throw shapeError();
  let contents;
  try { contents = JSON.parse(await readFile(lock.path, 'utf8')); } catch { throw shapeError(); }
  if (contents?.pageId !== lock.pageId || contents?.nonce !== lock.nonce) throw shapeError();
  await unlink(lock.path);
  await syncDirectory(lock.parent);
}

export async function main() {
  const selectedPageId = required('MSP_FACEBOOK_MEDIA_CANARY_PAGE_ID');
  const selectedPageName = required('MSP_FACEBOOK_MEDIA_CANARY_PAGE_NAME');
  if (!safeId(selectedPageId) || !selectedPageName.trim()
    || required('MSP_FACEBOOK_MEDIA_CANARY_EXECUTE') !== 'YES'
    || required('MSP_FACEBOOK_MEDIA_CANARY_ACK') !== `POST_AND_CLEANUP_TEMPORARY_MEDIA_ON_PAGE_${selectedPageId}`
    || required('MSP_FACEBOOK_MEDIA_FIXTURE_ACK') !== 'USE_GENERATED_CANARY_IMAGES_ONLY') throw shapeError();

  const appRoot = required('MSP_FACEBOOK_PROBE_APP_ROOT');
  activeStage = 'private_bundle_preflight';
  const probeDirectory = await requirePrivateDirectory(required('MSP_FACEBOOK_PROBE_DIR'));
  if (!isAbsolute(appRoot)) throw shapeError();
  const engineFile = await readPinnedFile(probeDirectory, 'socialpilot-facebook-engine54.mjs', required('MSP_FACEBOOK_MEDIA_ENGINE_SHA256'));
  const defaultsFile = await readPinnedFile(probeDirectory, 'socialpilot-facebook-defaults54.json', required('MSP_FACEBOOK_MEDIA_DEFAULTS_SHA256'));
  const fixtureImages = [generatePngFixture(0), generatePngFixture(1)];
  if (fixtureImages.some(image => image.bytes.byteLength > 8 * 1024 * 1024 || !validPngSignature(image.bytes))) throw shapeError();

  const expectedGraphOrigin = new URL(required('MSP_FACEBOOK_PROBE_GRAPH_ORIGIN'));
  if (expectedGraphOrigin.protocol !== 'https:' || expectedGraphOrigin.username || expectedGraphOrigin.password
    || expectedGraphOrigin.pathname !== '/' || expectedGraphOrigin.search || expectedGraphOrigin.hash) throw shapeError();
  const requireFromApp = createRequire(join(resolve(appRoot), 'package.json'));
  activeStage = 'legacy_credential_preflight';
  const { PrismaClient } = requireFromApp('@prisma/client');
  const settingsImport = await import(pathToFileURL(join(appRoot, 'src/lib/settings/index.ts')).href);
  const settings = settingsImport.default ?? settingsImport;
  await settings.ensureSettings();
  const envImport = await import(pathToFileURL(join(appRoot, 'src/lib/env.ts')).href);
  const { env } = envImport.default ?? envImport;
  const cryptoImport = await import(pathToFileURL(join(appRoot, 'src/lib/crypto.ts')).href);
  const { decryptSecret } = cryptoImport.default ?? cryptoImport;
  const config = JSON.parse(defaultsFile.bytes.toString('utf8'));
  if (!Number.isSafeInteger(config.maxImageUploadBytes) || fixtureImages.some(image => image.bytes.byteLength > config.maxImageUploadBytes)) throw shapeError();
  config.graphBaseUrl = env.graphBaseUrl;
  config.graphVersion = env.graphVersion;
  config.requestTimeoutMs = env.graphTimeoutMs;
  config.appSecret = env.facebookAppSecret;
  const graphEndpoint = new URL(config.graphBaseUrl);
  if (graphEndpoint.origin !== expectedGraphOrigin.origin || graphEndpoint.username || graphEndpoint.password
    || config.appSecretProofEnabled !== true || !config.appSecret?.trim()) throw shapeError();

  const database = new PrismaClient({ log: [] });
  let source;
  try {
    source = await database.$transaction(async tx => {
      await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
      const rows = await tx.target.findMany({
        where: { providerId: selectedPageId, type: 'page', enabled: true, canPublish: true, accessToken: { not: null },
          socialAccount: { provider: 'facebook', invalidatedAt: null, OR: [{ tokenExpiresAt: null }, { tokenExpiresAt: { gt: new Date() } }] } },
        select: { id: true, workspaceId: true, providerId: true, name: true, accessToken: true,
          socialAccount: { select: { workspaceId: true, provider: true, providerUserId: true, accessToken: true, scopes: true, invalidatedAt: true, tokenExpiresAt: true } } },
      });
      return rows.length === 1 ? rows[0] : null;
    });
  } finally {
    await database.$disconnect().catch(() => {});
  }
  if (!source || source.name !== selectedPageName || source.providerId !== selectedPageId
    || source.socialAccount?.workspaceId !== source.workspaceId || source.socialAccount?.provider !== 'facebook'
    || source.socialAccount.invalidatedAt || (source.socialAccount.tokenExpiresAt && source.socialAccount.tokenExpiresAt <= new Date())) throw shapeError();

  const { createFacebookEngine } = await import(pathToFileURL(engineFile.path).href);
  const engine = createFacebookEngine(config);
  const accountToken = decryptSecret(source.socialAccount.accessToken);
  const pageToken = decryptSecret(source.accessToken);
  if (!accountToken.trim() || !pageToken.trim()) throw shapeError();

  activeStage = 'provider_identity_read';
  const user = await engine.getCurrentUser(accountToken);
  if (user.id !== source.socialAccount.providerUserId) throw new Error('The active Facebook identity does not match the selected connection.');
  const granted = await engine.getGrantedPermissions(accountToken);
  if (!granted.includes('pages_manage_posts')) throw new Error('The selected connection lacks the required current publishing grant.');
  const discoveredPages = await engine.discoverPages(accountToken);
  if (!discoveredPages.some(page => page.id === selectedPageId)) throw new Error('The selected Page is no longer discoverable on this connection.');
  const pageIdentity = await engine.getCurrentUser(pageToken);
  if (pageIdentity.id !== selectedPageId) throw new Error('The stored selected Page token does not match the selected Page.');

  const ledgerParent = await requirePrivateDirectory(required('MSP_FACEBOOK_MEDIA_LEDGER_PARENT'));
  const pageLock = await acquirePageLock(ledgerParent, selectedPageId);
  activeLockPath = pageLock.path;
  await assertNoUnresolvedPriorLedger(ledgerParent, selectedPageId);
  const runDirectory = await createRunDirectory(ledgerParent);
  activeLedgerPath = join(runDirectory, 'run.json');
  const operationId = randomUUID();
  const canaryCaption = `${CANARY_CAPTION} Run ${operationId} at ${new Date().toISOString()}.`;
  const ledger = {
    version: 1,
    operationId,
    workspaceId: source.workspaceId,
    targetId: source.id,
    remoteTargetId: selectedPageId,
    pageDisplayName: selectedPageName,
    createdAt: new Date().toISOString(),
    engineSha256: sha256(engineFile.bytes),
    status: 'ready',
    steps: [],
    feed: null,
    verification: { pageIdentity: true, currentPublishingGrant: true, fixtureCount: fixtureImages.length },
    cleanup: { status: 'pending', note: null },
  };
  await writeLedger(runDirectory, ledger);

  const controller = new AbortController();
  const publishEngine = createFacebookEngine(config, fetch, controller.signal, createFileJournal(runDirectory, ledger));
  const abort = () => controller.abort();
  process.once('SIGINT', abort);
  process.once('SIGTERM', abort);
  let publishError = false;
  try {
    activeStage = 'multi_photo_publish';
    ledger.status = 'publishing';
    await writeLedger(runDirectory, ledger);
    try {
      const published = await publishEngine.publish({ targetId: selectedPageId, accessToken: pageToken, operationId,
        text: canaryCaption, media: fixtureImages.map((image, index) => ({ kind: 'image',
          // Engine validation requires a nonempty URL; localFile makes it send multipart bytes instead.
          url: `https://fixture.invalid/msp-canary-${index + 1}.png`, altText: `Temporary generated canary image ${index + 1}`,
          localFile: { bytes: image.bytes, mimeType: image.mimeType, fileName: image.fileName } })) });
      if (!ledger.feed || ledger.feed.state !== 'recorded' || published.remoteId !== ledger.feed.remoteId) throw new Error('The returned feed receipt does not match its durable journal receipt.');
      ledger.status = 'published';
      await writeLedger(runDirectory, ledger);
    } catch (error) {
      publishError = true;
      ledger.lastFailure = { stage: activeStage, ...safeFailureMetadata(error) };
      ledger.status = 'publish_needs_review';
      await writeLedger(runDirectory, ledger);
    }

    if (ledger.feed?.state === 'recorded' && safeId(ledger.feed.remoteId)) {
      try {
        activeStage = 'provider_readback';
        const status = await engine.getStatus(pageToken, ledger.feed.remoteId);
        ledger.verification.feedPublished = status.state === 'published';
        const states = await Promise.all(ledger.steps.filter(step => step.phase === 'photo' && step.state === 'recorded').map(step => engine.getPhotoCleanupState(pageToken, step.remoteId)));
        ledger.verification.photoAssociation = states.length === 2 && states.every((state, index) =>
          state.id === ledger.steps.filter(step => step.phase === 'photo').sort((a, b) => a.ordinal - b.ordinal)[index]?.remoteId
          && state.page_story_id === ledger.feed.remoteId);
      } catch {
        ledger.verification.readback = 'unknown';
      }
      await writeLedger(runDirectory, ledger);
    }
  } finally {
    process.removeListener('SIGINT', abort);
    process.removeListener('SIGTERM', abort);
    // Cleanup is deliberately detached from a cancelled publish signal. The
    // durable file ledger decides which exact IDs are safe to clean and when.
    try { activeStage = 'provider_cleanup'; await cleanupKnownMedia(engine, pageToken, ledger, runDirectory); }
    catch {
      ledger.cleanup.status = 'held_cleanup_error';
      ledger.cleanup.note = 'Cleanup did not complete; inspect the retained private ledger. Do not repeat any started action.';
      await writeLedger(runDirectory, ledger).catch(() => {});
    }
  }

  let cleanLedger = false;
  let ledgerRemoved = false;
  try {
    if (canFinalizeCompletedRun(ledger, publishError)) {
      cleanLedger = await finalizeCompletedRun(runDirectory, ledgerParent, ledger, publishError);
      ledgerRemoved = cleanLedger;
      if (ledgerRemoved) {
        activeLedgerPath = undefined;
        await releasePageLock(pageLock);
        activeLockPath = undefined;
      }
    }
  }
  catch {
    cleanLedger = false;
    if (!ledgerRemoved) {
      ledger.cleanup.status = 'held_ledger_finalize_error';
      ledger.cleanup.note = 'Final ledger removal failed; retain and inspect the private ledger.';
      await writeLedger(runDirectory, ledger).catch(() => {});
    }
  }
  output({
    probe: 'facebook-live-media-canary',
    ok: cleanLedger,
    pageIdentityVerified: true,
    publishingGrantVerified: true,
    fixtureImagesChecked: fixtureImages.length,
    photoReceiptsRecorded: ledger.steps.filter(step => step.phase === 'photo' && step.state === 'recorded').length,
    feedReceiptRecorded: ledger.feed?.state === 'recorded',
    feedPublishedVerified: ledger.verification.feedPublished === true,
    photoAssociationVerified: ledger.verification.photoAssociation === true,
    cleanupStatus: ledger.cleanup.status,
    ledgerRetained: !ledgerRemoved,
    ...(!ledgerRemoved ? { privateLedgerPath: join(runDirectory, 'run.json') } : {}),
    lockRetained: Boolean(activeLockPath),
    ...(activeLockPath ? { privatePageLockPath: activeLockPath } : {}),
    providerWriteMayHaveOccurred: ledger.steps.length > 0 || ledger.feed !== null,
    productionDatabaseWrites: false,
    rebuildUiApiMcpVerified: false,
    limitation: 'Engine-only legacy credential bridge; no production database journal or rebuild UI/API/MCP path was exercised.',
  });
  if (!cleanLedger) process.exitCode = 2;
}

const invokedDirectly = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (invokedDirectly) {
  try {
    await main();
  } catch (error) {
    output({ ...failure('Readiness or canary action failed; sensitive details withheld.'), stage: activeStage,
      ...safeFailureMetadata(error),
      ...(activeLedgerPath ? { ledgerRetained: true, privateLedgerPath: activeLedgerPath } : {}),
      ...(activeLockPath ? { lockRetained: true, privatePageLockPath: activeLockPath } : {}) });
    process.exitCode = 1;
  }
}
