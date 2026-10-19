import { beforeEach, describe, expect, it, vi } from 'vitest';
import { chmod, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { runtimeConfigBatch } from '../src/server/config/store';
const sharpControl = vi.hoisted(() => ({ factory: null as null | ((...args: any[]) => any) }));
const configValues = {
  'media.inspectMaxBytes': 536_870_912,
  'media.inspectMaxPixels': 100_000_000,
  'media.inspectTimeoutMs': 15_000,
  'media.inspectMaxOutputBytes': 1_048_576,
  'media.inspectMaxConcurrentImages': 2,
  'media.ffprobePath': 'ffprobe',
  'media.inspectTempRoot': '/tmp',
};
vi.mock('../src/server/config/store', () => ({
  runtimeConfigBatch: vi.fn(async (keys: string[]) => Object.fromEntries(keys.map(key => [key, configValues[key as keyof typeof configValues]]))),
}));
vi.mock('sharp', async importOriginal => {
  const actual: any = await importOriginal();
  const actualSharp = actual.default ?? actual;
  const wrapped = new Proxy(actualSharp, {
    apply(target, receiver, args) {
      if (sharpControl.factory) return sharpControl.factory(...args);
      return Reflect.apply(target, receiver, args);
    },
  });
  return { ...actual, default: wrapped };
});
import { checkMediaProbeAvailability, inspectMediaSnapshot } from '../src/server/media/inspect';

const readConfig = async (keys: readonly string[]) => Object.fromEntries(keys.map(key => [key, configValues[key as keyof typeof configValues]]));

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/cXcAAAAASUVORK5CYII=',
  'base64',
);

describe('inspectMediaSnapshot', () => {
  beforeEach(() => {
    vi.mocked(runtimeConfigBatch).mockReset();
    vi.mocked(runtimeConfigBatch).mockImplementation(readConfig);
    sharpControl.factory = null;
  });
  it('returns dimensions, canonical MIME, size, and digest from image bytes', async () => {
    const result = await inspectMediaSnapshot(PNG_1X1, 'image');

    expect(result).toMatchObject({
      mimeType: 'image/png',
      sizeBytes: PNG_1X1.length,
      width: 1,
      height: 1,
    });
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.bytes).toEqual(PNG_1X1);
    expect(result.bytes).not.toBe(PNG_1X1);
  });

  it('copies the input bytes before waiting for configuration', async () => {
    const source = Buffer.from(PNG_1X1);
    const original = Buffer.from(source);
    let resume!: () => void;
    vi.mocked(runtimeConfigBatch).mockImplementation(async keys => {
      await new Promise<void>(resolve => { resume = resolve; });
      return readConfig(keys);
    });

    const pending = inspectMediaSnapshot(source, 'image');
    source.fill(0);
    resume();
    const result = await pending;

    expect(result.bytes).toEqual(original);
    expect(result.bytes).not.toBe(source);
  });

  it('enforces the Root configured byte ceiling', async () => {
    vi.mocked(runtimeConfigBatch).mockImplementation(async keys => Object.fromEntries(keys.map(key => [
      key,
      key === 'media.inspectMaxBytes' ? PNG_1X1.length - 1 : configValues[key as keyof typeof configValues],
    ])));
    await expect(inspectMediaSnapshot(PNG_1X1, 'image')).rejects.toThrow('Media inspection failed.');
  });

  it('rejects malformed image bytes with a safe operation error', async () => {
    await expect(inspectMediaSnapshot(Buffer.from('not an image'), 'image'))
      .rejects.toThrow('Media inspection failed.');
  });

  it('rejects invalid runtime input without exposing a native type error', async () => {
    await expect(inspectMediaSnapshot(null as unknown as Uint8Array, 'image'))
      .rejects.toThrow('Media inspection failed.');
  });

  it('reports EXIF-rotated image dimensions in displayed orientation', async () => {
    const bytes = await sharp({ create: { width: 2, height: 1, channels: 3, background: '#f00' } })
      .jpeg().withMetadata({ orientation: 6 }).toBuffer();
    await expect(inspectMediaSnapshot(bytes, 'image')).resolves.toMatchObject({ width: 1, height: 2, mimeType: 'image/jpeg' });
  });

  it('rejects a declared image kind when the bytes identify another media kind', async () => {
    const webmHeader = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x93, 0x42, 0x82, 0x84, 0x77, 0x65, 0x62, 0x6d]);
    await expect(inspectMediaSnapshot(webmHeader, 'image'))
      .rejects.toThrow('Media inspection failed.');
  });

  it('rejects EBML data unless the exact header DocType is webm or matroska', async () => {
    const wrongDocType = Buffer.concat([
      Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x87, 0x42, 0x82, 0x85]),
      Buffer.from('other'),
      Buffer.from([0, 0]),
    ]);
    await expect(inspectMediaSnapshot(wrongDocType, 'video')).rejects.toThrow('Media inspection failed.');
  });

  it('reports configured ffprobe as available only after validating its version banner', async () => {
    await expect(checkMediaProbeAvailability()).resolves.toEqual({ available: true });

    vi.mocked(runtimeConfigBatch).mockImplementation(async keys => Object.fromEntries(keys.map(key => [
      key,
      key === 'media.ffprobePath' ? '/bin/echo' : configValues[key as keyof typeof configValues],
    ])));
    await expect(checkMediaProbeAvailability()).rejects.toThrow('Media inspection failed.');
  });

  it('kills an already cancelled probe request before launching a process', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(checkMediaProbeAvailability(controller.signal)).rejects.toThrow('Media inspection failed.');
  });

  it('caps probe output and hides the configured executable path from errors', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'media-inspect-test-'));
    const executable = join(directory, 'probe');
    try {
      await writeFile(executable, '#!/usr/bin/env node\nprocess.stdout.write("x".repeat(4096));\n');
      await chmod(executable, 0o700);
      vi.mocked(runtimeConfigBatch).mockImplementation(async keys => Object.fromEntries(keys.map(key => [
        key,
        key === 'media.ffprobePath' ? executable
          : key === 'media.inspectMaxOutputBytes' ? 1024
            : configValues[key as keyof typeof configValues],
      ])));
      await expect(checkMediaProbeAvailability()).rejects.toThrow('Media inspection failed.');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('probes a private local snapshot, rotates dimensions, and keeps the longest container duration', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'media-inspect-video-test-'));
    const executable = join(directory, 'probe with spaces');
    const probe = {
      programs: [],
      stream_groups: [],
      streams: [
        { codec_name: 'mpeg4', codec_type: 'video', width: 16, height: 9, duration: '1.000000', disposition: { attached_pic: 0 }, side_data_list: [{ rotation: -90 }] },
        { codec_name: 'aac', codec_type: 'audio', duration: '2.000000' },
      ],
      format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2', duration: '2.500000' },
    };
    try {
      const script = `#!/usr/bin/env node\nconst fs = require('node:fs');\nconst input = process.argv[process.argv.length - 1];\nconst stat = fs.statSync(input);\nif ((stat.mode & 0o777) !== 0o600 || fs.readFileSync(input).toString('ascii', 4, 8) !== 'ftyp') process.exit(2);\nprocess.stdout.write(${JSON.stringify(JSON.stringify(probe))});\n`;
      await writeFile(executable, script);
      await chmod(executable, 0o700);
      vi.mocked(runtimeConfigBatch).mockImplementation(async keys => Object.fromEntries(keys.map(key => [
        key,
        key === 'media.ffprobePath' ? executable
          : key === 'media.inspectTempRoot' ? directory
            : configValues[key as keyof typeof configValues],
      ])));
      const bytes = Buffer.concat([Buffer.alloc(4), Buffer.from('ftyp'), Buffer.alloc(4)]);
      const result = await inspectMediaSnapshot(bytes, 'video');

      expect(result).toMatchObject({ mimeType: 'video/mp4', width: 9, height: 16, durationSeconds: 2.5 });
      expect(result.bytes).toEqual(bytes);
      expect(await readdir(directory)).toEqual(['probe with spaces']);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it.each(['timeout', 'abort'] as const)('retains an image decode permit until %s Sharp work settles', async cancellation => {
    const pendingPng = Buffer.from(PNG_1X1);
    let rejectStats!: () => void;
    let startedStats!: () => void;
    const statsStarted = new Promise<void>(resolve => { startedStats = resolve; });
    const deferredStats = new Promise<unknown>((_resolve, reject) => { rejectStats = () => reject(new Error('late Sharp result')); });
    const controller = new AbortController();
    vi.mocked(runtimeConfigBatch).mockImplementation(async keys => Object.fromEntries(keys.map(key => [
      key,
      key === 'media.inspectTimeoutMs' ? 100
        : key === 'media.inspectMaxConcurrentImages' ? 1
          : configValues[key as keyof typeof configValues],
    ])));
    sharpControl.factory = () => ({
      metadata: async () => ({ format: 'png', width: 1, height: 1 }),
      stats: () => { startedStats(); return deferredStats; },
    });
    try {
      const first = inspectMediaSnapshot(pendingPng, 'image', cancellation === 'abort' ? { signal: controller.signal } : {});
      await statsStarted;
      if (cancellation === 'abort') controller.abort();
      await expect(first).rejects.toThrow('Media inspection failed.');
      await expect(inspectMediaSnapshot(pendingPng, 'image')).rejects.toThrow('Media inspection failed.');

      rejectStats();
      await new Promise(resolve => setImmediate(resolve));
      sharpControl.factory = null;
      await expect(inspectMediaSnapshot(pendingPng, 'image')).resolves.toMatchObject({ width: 1, height: 1 });
    } finally {
      rejectStats();
      sharpControl.factory = null;
    }
  });

  it('does not start Sharp stats when metadata returns after the inspection deadline', async () => {
    let resolveMetadata!: (value: unknown) => void;
    let startedMetadata!: () => void;
    const metadataStarted = new Promise<void>(resolve => { startedMetadata = resolve; });
    const deferredMetadata = new Promise<unknown>(resolve => { resolveMetadata = resolve; });
    let statsCalls = 0;
    vi.mocked(runtimeConfigBatch).mockImplementation(async keys => Object.fromEntries(keys.map(key => [
      key,
      key === 'media.inspectTimeoutMs' ? 100
        : key === 'media.inspectMaxConcurrentImages' ? 1
          : configValues[key as keyof typeof configValues],
    ])));
    sharpControl.factory = () => ({
      metadata: () => { startedMetadata(); return deferredMetadata; },
      stats: () => { statsCalls++; return Promise.resolve({}); },
    });
    try {
      const first = inspectMediaSnapshot(PNG_1X1, 'image');
      await metadataStarted;
      await expect(first).rejects.toThrow('Media inspection failed.');
      await expect(inspectMediaSnapshot(PNG_1X1, 'image')).rejects.toThrow('Media inspection failed.');

      resolveMetadata({ format: 'png', width: 1, height: 1 });
      await new Promise(resolve => setImmediate(resolve));
      expect(statsCalls).toBe(0);

      sharpControl.factory = null;
      await expect(inspectMediaSnapshot(PNG_1X1, 'image')).resolves.toMatchObject({ width: 1, height: 1 });
    } finally {
      resolveMetadata({ format: 'png', width: 1, height: 1 });
      sharpControl.factory = null;
    }
  });
});
