import { lookup } from 'node:dns/promises';
import { runtimeConfigBatch } from '@/server/config/store';
import { MEDIA_INSPECTION_CONFIG } from '@/modules/publishing/server/media/inspection-config';
import { inspectMediaSnapshot, type MediaSnapshot } from '@/modules/publishing/server/media/inspect';
import { guardedFetch, type FetchDeps, type FetchPolicy } from '@/modules/publishing/server/media/network/net-guard';
import { pinnedFetcher } from '@/modules/publishing/server/media/network/pinned-fetch';

type RemoteMediaKind = 'image' | 'video';
export type RemoteMediaSnapshot = Readonly<MediaSnapshot>;

/** Safe failure that never includes the supplied URL, response headers, or transport details. */
export class RemoteMediaSnapshotError extends Error {
  constructor() {
    super('The media source could not be safely inspected.');
    this.name = 'RemoteMediaSnapshotError';
  }
}

const CONFIG_KEYS = [
  'media.inspectMaxBytes',
  'media.inspectFetchTimeoutMs',
  'media.inspectMaxRedirects',
  'media.inspectAllowHttp',
  'media.inspectHostAllowlist',
] as const;

const configEntries = new Map(MEDIA_INSPECTION_CONFIG.map(entry => [entry.key, entry]));

function validatedConfigValue(config: Record<string, unknown>, key: typeof CONFIG_KEYS[number]): unknown {
  const entry = configEntries.get(key);
  if (!entry) throw new RemoteMediaSnapshotError();
  const checked = entry.schema.safeParse(config[key]);
  if (!checked.success) throw new RemoteMediaSnapshotError();
  return checked.data;
}

async function readPolicy(): Promise<FetchPolicy> {
  const config = await runtimeConfigBatch(CONFIG_KEYS);
  return {
    maxBytes: validatedConfigValue(config, 'media.inspectMaxBytes') as number,
    timeoutMs: validatedConfigValue(config, 'media.inspectFetchTimeoutMs') as number,
    maxRedirects: validatedConfigValue(config, 'media.inspectMaxRedirects') as number,
    allowHttp: validatedConfigValue(config, 'media.inspectAllowHttp') as boolean,
    hostAllowlist: validatedConfigValue(config, 'media.inspectHostAllowlist') as string[],
  };
}

const fetchDeps: FetchDeps = {
  async resolve(hostname, _signal) {
    const answers = await lookup(hostname, { all: true, verbatim: true });
    return answers.map(answer => answer.address);
  },
  fetcher: request => pinnedFetcher(request),
};

/**
 * Fetch a remote source through the bounded, address-pinned guard, then derive
 * all trusted metadata from the exact fetched bytes. Caller metadata and remote
 * response declarations are never used as inspection evidence.
 */
export async function resolveRemoteMediaSnapshot(
  url: string,
  kind: RemoteMediaKind,
  options: { signal?: AbortSignal } = {},
): Promise<RemoteMediaSnapshot> {
  try {
    if (options.signal?.aborted) throw new RemoteMediaSnapshotError();
    const policy = await readPolicy();
    if (options.signal?.aborted) throw new RemoteMediaSnapshotError();
    const fetched = await guardedFetch(url, policy, fetchDeps, { signal: options.signal });
    if (fetched.notModified || options.signal?.aborted) throw new RemoteMediaSnapshotError();
    const inspected = await inspectMediaSnapshot(fetched.bytes, kind, { signal: options.signal });
    if (options.signal?.aborted) throw new RemoteMediaSnapshotError();
    // Freeze metadata and keep the byte snapshot private. The getter returns a
    // fresh view so a consumer cannot mutate bytes observed by a later consumer.
    const stableBytes = Buffer.from(inspected.bytes);
    return Object.freeze({
      get bytes() { return Buffer.from(stableBytes); },
      sha256: inspected.sha256,
      mimeType: inspected.mimeType,
      sizeBytes: inspected.sizeBytes,
      width: inspected.width,
      height: inspected.height,
      ...(inspected.durationSeconds !== undefined ? { durationSeconds: inspected.durationSeconds } : {}),
    });
  } catch {
    throw new RemoteMediaSnapshotError();
  }
}
