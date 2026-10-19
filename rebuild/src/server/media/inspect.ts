import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { constants as fsConstants } from 'node:fs';
import { chmod, lstat, mkdtemp, open, realpath, rm, stat } from 'node:fs/promises';
import { basename, isAbsolute, join } from 'node:path';
import sharp from 'sharp';
import { z } from 'zod';
import { runtimeConfigBatch } from '@/server/config/store';
import { MEDIA_INSPECTION_CONFIG } from '@/server/media/inspection-config';

export type MediaInspectionSettings = {
  inspectMaxBytes: number;
  inspectMaxPixels: number;
  inspectTimeoutMs: number;
  inspectMaxOutputBytes: number;
  inspectMaxConcurrentImages: number;
  ffprobePath: string;
  inspectTempRoot: string;
};

export type MediaInspectionOptions = {
  signal?: AbortSignal;
};

export type MediaSnapshot = {
  bytes: Buffer;
  sha256: string;
  mimeType: string;
  sizeBytes: number;
  width: number;
  height: number;
  durationSeconds?: number;
};

/** Deliberately contains no path, tool output, or underlying system error. */
export class MediaInspectionError extends Error {
  constructor() {
    super('Media inspection failed.');
    this.name = 'MediaInspectionError';
  }
}

type ImageFormat = 'png' | 'jpeg' | 'gif' | 'webp';
type VideoFormat = { demuxer: 'mov' | 'matroska'; mimeType: 'video/mp4' | 'video/webm' | 'video/x-matroska' };

const INSPECTION_KEYS = [
  'media.inspectMaxBytes', 'media.inspectMaxPixels', 'media.inspectTimeoutMs',
  'media.inspectMaxOutputBytes', 'media.ffprobePath', 'media.inspectTempRoot',
  'media.inspectMaxConcurrentImages',
] as const;
const INSPECTION_ENTRIES = INSPECTION_KEYS.map(key => MEDIA_INSPECTION_CONFIG.find(entry => entry.key === key)!);
let activeImageInspections = 0;

function fail(): never { throw new MediaInspectionError(); }

function validPositiveInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function withinRegisteredInputMaximum(value: number): boolean {
  const schema = INSPECTION_ENTRIES[0]!.schema;
  if (!(schema instanceof z.ZodNumber) || !Number.isSafeInteger(value) || value < 1) return false;
  const maximum = schema._def.checks.find(check => check.kind === 'max')?.value;
  return typeof maximum === 'number' && value <= maximum;
}

function imageFormat(bytes: Buffer): ImageFormat | null {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  if (bytes.length >= 6 && ['GIF87a', 'GIF89a'].includes(bytes.toString('ascii', 0, 6))) return 'gif';
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}

function vintLength(first: number, maxLength = 8): number | null {
  if (!first) return null;
  let mask = 0x80;
  let length = 1;
  while (!(first & mask)) { mask >>= 1; length++; }
  return length <= maxLength ? length : null;
}

function vintValue(bytes: Buffer, offset: number, length: number): number | null {
  const markerMask = 2 ** (8 - length);
  let value = bytes[offset]! & (markerMask - 1);
  for (let i = 1; i < length; i++) value = value * 256 + bytes[offset + i]!;
  if (!Number.isSafeInteger(value) || value === 2 ** (7 * length) - 1) return null;
  return value;
}

function ebmlDocType(bytes: Buffer): 'webm' | 'matroska' | null {
  if (bytes.length < 5 || !bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) return null;
  const headerSizeLength = vintLength(bytes[4]!);
  if (!headerSizeLength) return null;
  const headerSize = vintValue(bytes, 4, headerSizeLength);
  if (headerSize === null || headerSize > 4096) return null;
  const headerEnd = 4 + headerSizeLength + headerSize;
  if (headerEnd > bytes.length) return null;
  let docType: 'webm' | 'matroska' | null = null;
  for (let offset = 4 + headerSizeLength; offset < headerEnd;) {
    const idLength = vintLength(bytes[offset]!, 4);
    if (!idLength || offset + idLength >= headerEnd) return null;
    let id = 0;
    for (let i = 0; i < idLength; i++) id = (id << 8) | bytes[offset + i]!;
    const sizeOffset = offset + idLength;
    const sizeLength = vintLength(bytes[sizeOffset]!);
    if (!sizeLength || sizeOffset + sizeLength > headerEnd) return null;
    const size = vintValue(bytes, sizeOffset, sizeLength);
    if (size === null || size > headerEnd) return null;
    const valueOffset = sizeOffset + sizeLength;
    const end = valueOffset + size;
    if (end > headerEnd) return null;
    if (id === 0x4282) {
      if (docType !== null) return null;
      const value = bytes.toString('ascii', valueOffset, end);
      if (value !== 'webm' && value !== 'matroska') return null;
      docType = value;
    }
    offset = end;
  }
  return docType;
}

function videoFormat(bytes: Buffer): VideoFormat | null {
  if (bytes.length >= 12 && bytes.toString('ascii', 4, 8) === 'ftyp') return { demuxer: 'mov', mimeType: 'video/mp4' };
  const docType = ebmlDocType(bytes);
  if (docType === 'webm') return { demuxer: 'matroska', mimeType: 'video/webm' };
  if (docType === 'matroska') return { demuxer: 'matroska', mimeType: 'video/x-matroska' };
  return null;
}

function mimeForImage(format: ImageFormat): string {
  return format === 'jpeg' ? 'image/jpeg' : `image/${format}`;
}

async function validateToolPath(value: string): Promise<string> {
  if (value === 'ffprobe') return value;
  if (!isAbsolute(value) || basename(value) === '' || value.includes('\0')) fail();
  const canonical = await realpath(value);
  const info = await stat(canonical);
  if (!info.isFile()) fail();
  await import('node:fs/promises').then(fs => fs.access(canonical, fsConstants.X_OK));
  return canonical;
}

async function canonicalTempRoot(value: string): Promise<string> {
  if (!isAbsolute(value) || value.includes('\0')) fail();
  const canonical = await realpath(value);
  if (!(await stat(canonical)).isDirectory()) fail();
  return canonical;
}

function finitePositive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function withImageDeadline<T>(work: Promise<T>, timeoutMs: number, signal?: AbortSignal): Promise<T> {
  if (signal?.aborted) return Promise.reject(new MediaInspectionError());
  return new Promise<T>((resolveWork, rejectWork) => {
    let settled = false;
    const finish = (error?: unknown, value?: T) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      if (error) rejectWork(new MediaInspectionError());
      else resolveWork(value as T);
    };
    const onAbort = () => finish(new MediaInspectionError());
    const timer = setTimeout(() => finish(new MediaInspectionError()), timeoutMs);
    signal?.addEventListener('abort', onAbort, { once: true });
    work.then(value => finish(undefined, value), () => finish(new MediaInspectionError()));
  });
}

function parsePositiveNumber(value: unknown): number | undefined {
  if (finitePositive(value)) return value;
  if (typeof value !== 'string' || !/^(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value)) return undefined;
  const parsed = Number(value);
  return finitePositive(parsed) ? parsed : undefined;
}

function parsePositiveOrSignedNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string' || !/^-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseProbeOutput(text: string, maxPixels: number, expectedFormat: VideoFormat): { width: number; height: number; durationSeconds: number } {
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return fail(); }
  if (!parsed || typeof parsed !== 'object') return fail();
  const root = parsed as { streams?: unknown; format?: { duration?: unknown; format_name?: unknown }; [key: string]: unknown };
  if (Object.keys(root).some(key => !['streams', 'format', 'programs', 'stream_groups'].includes(key)) ||
    root.programs && (!Array.isArray(root.programs) || root.programs.length > 0) ||
    root.stream_groups && (!Array.isArray(root.stream_groups) || root.stream_groups.length > 0)) return fail();
  if (!root.format || typeof root.format !== 'object' || Object.keys(root.format).some(key => !['duration', 'format_name'].includes(key))) return fail();
  const formatName = root.format.format_name;
  if (typeof formatName !== 'string') return fail();
  if (!Array.isArray(root.streams) || root.streams.length === 0) return fail();
  const videos = root.streams.filter((entry: any) => entry && entry.codec_type === 'video');
  if (videos.length !== 1) return fail();
  for (const entry of root.streams as any[]) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) ||
      Object.keys(entry).some(key => !['codec_type', 'codec_name', 'width', 'height', 'duration', 'disposition', 'side_data_list'].includes(key)) ||
      !['audio', 'video', 'subtitle', 'data', 'attachment'].includes(entry.codec_type) ||
      typeof entry.codec_name !== 'string' ||
      entry.disposition !== undefined && (!entry.disposition || typeof entry.disposition !== 'object' || Array.isArray(entry.disposition) || Object.keys(entry.disposition).some((key: string) => key !== 'attached_pic')) ||
      entry.side_data_list !== undefined && (!Array.isArray(entry.side_data_list) || entry.side_data_list.some((item: any) => !item || typeof item !== 'object' || Array.isArray(item) || Object.keys(item).some((key: string) => key !== 'rotation')))) return fail();
  }
  const stream = videos[0] as { width?: unknown; height?: unknown; duration?: unknown; codec_name?: unknown; disposition?: { attached_pic?: unknown; [key: string]: unknown }; side_data_list?: Array<{ rotation?: unknown }>; [key: string]: unknown };
  if (Object.keys(stream).some(key => !['codec_type', 'width', 'height', 'duration', 'codec_name', 'disposition', 'side_data_list'].includes(key))) return fail();
  if (stream.disposition && Object.keys(stream.disposition).some(key => key !== 'attached_pic')) return fail();
  if (stream.disposition?.attached_pic === 1 || stream.disposition?.attached_pic === '1') return fail();
  if (typeof stream.codec_name !== 'string') return fail();
  const names = formatName.split(',');
  const codecs = new Set(['h264', 'hevc', 'av1', 'mpeg4', 'vp8', 'vp9']);
  if (!codecs.has(stream.codec_name)) return fail();
  let width = parsePositiveNumber(stream.width);
  let height = parsePositiveNumber(stream.height);
  if (!width || !height || !Number.isSafeInteger(width) || !Number.isSafeInteger(height)) return fail();
  const rotations = stream.side_data_list?.filter(item => item.rotation !== undefined).map(item => item.rotation) ?? [];
  if (rotations.length > 1) return fail();
  const rotationValue = rotations[0];
  if (rotationValue !== undefined) {
    const rotation = parsePositiveOrSignedNumber(rotationValue);
    if (rotation === undefined || rotation % 90 !== 0) return fail();
    if (Math.abs(rotation % 180) === 90) [width, height] = [height, width];
  }
  if (width * height > maxPixels) return fail();
  const durations = [parsePositiveNumber(stream.duration), parsePositiveNumber(root.format?.duration)].filter((value): value is number => value !== undefined);
  const duration = durations.length ? Math.max(...durations) : undefined;
  if (!duration) return fail();
  if (expectedFormat.demuxer === 'matroska') {
    if (!names.every(name => ['matroska', 'webm'].includes(name)) || !names.includes('matroska') ||
      expectedFormat.mimeType === 'video/webm' && !names.includes('webm') ||
      expectedFormat.mimeType === 'video/x-matroska' && names.includes('webm') ||
      !['vp8', 'vp9', 'av1'].includes(stream.codec_name)) return fail();
  } else if (!names.every(name => ['mov', 'mp4', 'm4a', '3gp', '3g2', 'mj2'].includes(name)) || !names.includes('mov')) return fail();
  return { width, height, durationSeconds: duration };
}

async function readSettings(): Promise<MediaInspectionSettings> {
  const config = await runtimeConfigBatch(INSPECTION_KEYS);
  const value = (index: number) => INSPECTION_ENTRIES[index]!.schema.parse(config[INSPECTION_KEYS[index]!]);
  return {
    inspectMaxBytes: value(0) as number,
    inspectMaxPixels: value(1) as number,
    inspectTimeoutMs: value(2) as number,
    inspectMaxOutputBytes: value(3) as number,
    ffprobePath: value(4) as string,
    inspectTempRoot: value(5) as string,
    inspectMaxConcurrentImages: value(6) as number,
  };
}

async function runBounded(executable: string, args: string[], settings: MediaInspectionSettings, signal?: AbortSignal): Promise<string> {
  if (signal?.aborted) return fail();
  return new Promise<string>((resolveOutput, rejectOutput) => {
    let stdout = '';
    let outputBytes = 0;
    let settled = false;
    const child = spawn(executable, args, { shell: false, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let timer: ReturnType<typeof setTimeout>;
    const onAbort = () => { child.kill('SIGKILL'); settleFailure(); };
    const settleFailure = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      rejectOutput(new MediaInspectionError());
    };
    timer = setTimeout(() => { child.kill('SIGKILL'); settleFailure(); }, settings.inspectTimeoutMs);
    signal?.addEventListener('abort', onAbort, { once: true });
    const countOutput = (chunk: Buffer): boolean => {
      if (settled) return false;
      outputBytes += chunk.length;
      if (outputBytes > settings.inspectMaxOutputBytes) { child.kill('SIGKILL'); settleFailure(); return false; }
      return true;
    };
    child.stdout.on('data', (chunk: Buffer) => {
      if (!countOutput(chunk)) return;
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', countOutput);
    child.once('error', settleFailure);
    child.once('close', (code: number | null) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      if (settled) return;
      settled = true;
      if (code !== 0) rejectOutput(new MediaInspectionError());
      else resolveOutput(stdout);
    });
  });
}

async function probeVideo(
  bytes: Buffer,
  format: VideoFormat,
  settings: MediaInspectionSettings,
  signal?: AbortSignal,
): Promise<{ width: number; height: number; durationSeconds: number }> {
  if (signal?.aborted) fail();
  const tempRoot = await canonicalTempRoot(settings.inspectTempRoot);
  const executable = await validateToolPath(settings.ffprobePath);
  const directory = await mkdtemp(join(tempRoot, 'media-inspect-'));
  const filePath = join(directory, format.demuxer === 'mov' ? 'input.mp4' : 'input.webm');
  try {
    await chmod(directory, 0o700);
    const directoryInfo = await lstat(directory);
    if (!directoryInfo.isDirectory() || (directoryInfo.mode & 0o777) !== 0o700 || await realpath(directory) !== directory) fail();
    const handle = await open(filePath, 'wx', 0o600);
    try {
      await handle.chmod(0o600);
      if (((await handle.stat()).mode & 0o777) !== 0o600) fail();
      await handle.writeFile(bytes);
    } finally { await handle.close(); }
    if (signal?.aborted) fail();
    const args = [
      '-v', 'error', '-protocol_whitelist', 'file,pipe', '-f', format.demuxer,
      '-show_entries', 'stream=codec_type,codec_name,width,height,duration:stream_disposition=attached_pic:stream_side_data=rotation:format=format_name,duration',
      '-of', 'json', filePath,
    ];
    const output = await runBounded(executable, args, settings, signal);
    return parseProbeOutput(output, settings.inspectMaxPixels, format);
  } catch {
    return fail();
  } finally {
    try { await rm(directory, { recursive: true, force: true }); } catch { /* preserve the safe inspection error */ }
  }
}

/** Safe Root diagnostic proving the configured executable can run locally. */
export async function checkMediaProbeAvailability(signal?: AbortSignal): Promise<{ available: true }> {
  try {
    const settings = await readSettings();
    await canonicalTempRoot(settings.inspectTempRoot);
    const executable = await validateToolPath(settings.ffprobePath);
    const output = await runBounded(executable, ['-version'], settings, signal);
    if (!/^ffprobe version [^\s\r\n]+(?=\s|$)/.test(output)) return fail();
    return { available: true };
  } catch {
    return fail();
  }
}

/**
 * Snapshot bytes before doing any asynchronous work, then derive all metadata
 * from those bytes. The caller's MIME, dimensions, duration, and filename are
 * never consulted.
 */
export async function inspectMediaSnapshot(
  input: Uint8Array,
  kind: 'image' | 'video',
  options: MediaInspectionOptions = {},
): Promise<MediaSnapshot> {
  let bytes: Buffer;
  try {
    if (!(input instanceof Uint8Array) || !withinRegisteredInputMaximum(input.byteLength)) fail();
    bytes = Buffer.from(input);
  } catch {
    return fail();
  }
  let settings: MediaInspectionSettings;
  try {
    settings = await readSettings();
    if (!validPositiveInteger(settings.inspectMaxBytes) ||
      !validPositiveInteger(settings.inspectMaxPixels) || !validPositiveInteger(settings.inspectTimeoutMs) ||
      !validPositiveInteger(settings.inspectMaxOutputBytes) || bytes.length > settings.inspectMaxBytes || options.signal?.aborted) fail();
    let mimeType: string;
    let width: number;
    let height: number;
    let durationSeconds: number | undefined;
    if (kind === 'image') {
      const format = imageFormat(bytes);
      if (!format) fail();
      if (activeImageInspections >= settings.inspectMaxConcurrentImages) fail();
      const imageDeadlineAt = Date.now() + settings.inspectTimeoutMs;
      activeImageInspections++;
      const imageWork = (async () => {
        if (options.signal?.aborted || Date.now() >= imageDeadlineAt) fail();
        const metadata = await sharp(bytes, { failOn: 'error', limitInputPixels: settings.inspectMaxPixels }).metadata();
        if (metadata.format !== format || !finitePositive(metadata.width) || !finitePositive(metadata.height) ||
          metadata.width * metadata.height > settings.inspectMaxPixels) fail();
        if (options.signal?.aborted || Date.now() >= imageDeadlineAt) fail();
        await sharp(bytes, { failOn: 'error', limitInputPixels: settings.inspectMaxPixels }).stats();
        const rotate = metadata.orientation !== undefined && metadata.orientation >= 5 && metadata.orientation <= 8;
        return { width: rotate ? metadata.height : metadata.width, height: rotate ? metadata.width : metadata.height };
      })();
      void imageWork.then(
        () => { activeImageInspections--; },
        () => { activeImageInspections--; },
      );
      const oriented = await withImageDeadline(imageWork, settings.inspectTimeoutMs, options.signal);
      mimeType = mimeForImage(format);
      width = oriented.width;
      height = oriented.height;
    } else if (kind === 'video') {
      const format = videoFormat(bytes);
      if (!format) fail();
      const dimensions = await probeVideo(bytes, format, settings, options.signal);
      mimeType = format.mimeType;
      width = dimensions.width;
      height = dimensions.height;
      durationSeconds = dimensions.durationSeconds;
    } else return fail();
    const result: MediaSnapshot = {
      bytes,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      mimeType,
      sizeBytes: bytes.length,
      width,
      height,
    };
    if (durationSeconds !== undefined) result.durationSeconds = durationSeconds;
    return result;
  } catch {
    return fail();
  }
}
