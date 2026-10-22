import { CONFIG_BY_KEY } from '@/lib/config/registry';
import { moduleManifests } from '@/modules';
import { ROOT_JOBS } from '@/modules/root/jobs';
import { recordError } from '@/server/errors/recorder';
import { randomUUID } from 'node:crypto';
import { prisma } from '@/server/data';
import { runtimeConfig } from '@/server/config/store';
import { cronMatches } from './cron';
import { runWithJobContext } from './job-context';
import type { RetryBackoff } from './retry';

export type JobName = (typeof moduleManifests)[number]['jobs'][number]['name'] | (typeof ROOT_JOBS)[number]['name'];
export type WorkerLogger = (message: string, detail?: unknown) => void;
const MINUTE_MS = 60_000;
const SECOND_MS = 1_000;
type Job = { name: JobName; configKey: string };
const jobs: Job[] = [...moduleManifests.flatMap(module => [...module.jobs]), ...ROOT_JOBS];

export type WorkerDependencies = {
  readConfig: (key: string) => Promise<unknown>;
  execute: (job: JobName, now: Date, retryLimit: number, retryBackoff: RetryBackoff) => Promise<string>;
  tryLease: (job: JobName, owner: string, token: string, until: Date) => Promise<boolean>;
  renewLease: (job: JobName, token: string, until: Date) => Promise<boolean>;
  releaseLease: (job: JobName, token: string) => Promise<void>;
  writeRun: (input: { id: string; job: JobName; owner: string; startedAt: Date; finishedAt: Date; outcome: string; attempts: number; summary?: string; error?: string }) => Promise<void>;
  writeHeartbeat: (owner: string, jobs: JobName[], at: Date) => Promise<void>;
  alreadyRanThisMinute: (job: JobName, from: Date, until: Date) => Promise<boolean>;
  recordError?: typeof recordError;
  logger: WorkerLogger;
};

export function createWorker(deps: WorkerDependencies, owner: string, options: { jobs?: readonly JobName[]; heartbeat?: boolean } = {}) {
  const selectedJobs = options.jobs ? jobs.filter(job => options.jobs!.includes(job.name)) : jobs;
  const log: WorkerLogger = (message, detail) => {
    if (detail !== undefined) void (deps.recordError ?? recordError)({ source: 'worker', error: detail, location: message });
    deps.logger(message, detail);
  };
  const startedMinute = new Map<JobName, number>();
  const running = new Set<JobName>();
  const leaseTokens = new Map<JobName, string>();
  const shutdownAbort = new AbortController();
  let stopping = false;
  let lastHeartbeat = 0;
  // Bootstrap fallback prevents a hot loop if the first configuration read fails.
  // Successful ticks replace it with the current stored value.
  let pollIntervalMs = Number(CONFIG_BY_KEY.get('sync.workerPollSeconds')!.defaultValue) * SECOND_MS;

  async function launch(job: Job, now: Date, retryLimit: number, retryBackoff: RetryBackoff, leaseMs: number, renewalDivisor: number, errorLimit: number, summaryLimit: number, manual = false): Promise<boolean> {
    if (running.has(job.name) || stopping) return false;
    const minuteStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), now.getMinutes());
    const minuteEnd = new Date(minuteStart.getTime() + 60_000);
    if (!manual && startedMinute.get(job.name) === minuteStart.getTime()) return false;
    if (!manual && await deps.alreadyRanThisMinute(job.name, minuteStart, minuteEnd)) {
      startedMinute.set(job.name, minuteStart.getTime());
      return false;
    }
    if (!manual) startedMinute.set(job.name, minuteStart.getTime());
    running.add(job.name);
    const token = randomUUID();
    let acquired: boolean;
    try { acquired = await deps.tryLease(job.name, owner, token, new Date(Date.now() + leaseMs)); }
    catch (error) { running.delete(job.name); throw error; }
    if (!acquired) { running.delete(job.name); return false; }
    if (stopping) {
      await deps.releaseLease(job.name, token).catch(error => log(`lease release failed for ${job.name}`, error));
      running.delete(job.name);
      return false;
    }
    leaseTokens.set(job.name, token);
    const startedAt = new Date();
    let attempts = 0;
    let outcome = 'ok';
    let summary: string | undefined;
    let errorText: string | undefined;
    const renew = setInterval(() => {
      void deps.renewLease(job.name, token, new Date(Date.now() + leaseMs)).then(renewed => {
        if (!renewed) log(`lease for ${job.name} is no longer owned by this worker`);
      }).catch(error => log(`lease renewal failed for ${job.name}`, error));
    }, Math.max(1, Math.floor(leaseMs / renewalDivisor)));
    try {
      attempts = 1;
      summary = await runWithJobContext({ signal: shutdownAbort.signal, stopRequested: () => stopping }, () => deps.execute(job.name, new Date(), retryLimit, retryBackoff));
      if (/failed=[1-9]/.test(summary)) {
        outcome = 'failed'; errorText = `Some workspace sync items failed: ${summary}`;
        await (deps.recordError ?? recordError)({ source: 'worker', error: new Error(errorText), location: job.name });
      }
      log(`[${job.name}] ${summary}`);
    } catch (error) {
      outcome = 'failed';
      await (deps.recordError ?? recordError)({ source: 'worker', error, location: job.name });
      errorText = (error instanceof Error ? error.message : String(error)).slice(0, errorLimit);
      log(`[${job.name}] failed: ${errorText}`);
    } finally {
      clearInterval(renew);
      const finishedAt = new Date();
      await deps.writeRun({ id: randomUUID(), job: job.name, owner, startedAt, finishedAt, outcome, attempts, ...(summary ? { summary: summary.slice(0, summaryLimit) } : {}), ...(errorText ? { error: errorText.slice(0, errorLimit) } : {}) }).catch(error => log(`run audit write failed for ${job.name}`, error));
      await deps.releaseLease(job.name, token).catch(error => log(`lease release failed for ${job.name}`, error));
      leaseTokens.delete(job.name);
      running.delete(job.name);
    }
    return true;
  }

  /** On-demand execution bypasses the cron window, while retaining the same lease, history and error handling. */
  async function runNow(name: JobName): Promise<boolean> {
    const job = selectedJobs.find(item => item.name === name);
    if (!job || stopping) return false;
    const keys = ['sync.retryLimit', 'sync.retryBaseDelayMs', 'sync.retryMaxDelayMs', 'sync.workerLeaseMinutes', 'sync.workerLeaseRenewalDivisor', 'logging.workerErrorMaxCharacters', 'logging.workerSummaryMaxCharacters'] as const;
    const [retryLimit, baseDelay, maxDelay, leaseMinutes, renewalDivisor, errorLimit, summaryLimit] = await Promise.all(keys.map(async key => Number(await deps.readConfig(key))));
    return launch(job, new Date(), Math.max(0, Math.trunc(retryLimit)), { baseDelayMs: Math.max(1, Math.trunc(baseDelay)), maxDelayMs: Math.max(1, Math.trunc(maxDelay)) }, Math.max(1, Math.trunc(leaseMinutes)) * MINUTE_MS, renewalDivisor, errorLimit, summaryLimit, true);
  }

  /**
   * Stop claiming work, give in-flight jobs `graceMs` to finish at their own safe
   * points, then abort the rest and release their leases so another worker can
   * take over. Resolves with the jobs that were abandoned.
   */
  async function shutdown(graceMs: number, pollMs: number): Promise<{ abandoned: JobName[] }> {
    stopping = true;
    const waitUntil = async (deadline: number) => {
      while (running.size > 0 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, Math.min(pollMs, Math.max(1, deadline - Date.now()))));
    };
    await waitUntil(Date.now() + graceMs);
    if (running.size === 0) return { abandoned: [] };
    shutdownAbort.abort();
    // Aborted jobs get one more poll to unwind and write their own run record.
    await waitUntil(Date.now() + pollMs);
    const abandoned = [...running];
    for (const name of abandoned) {
      const token = leaseTokens.get(name);
      if (token) await deps.releaseLease(name, token).catch(error => log(`lease release failed for ${name}`, error));
      log(`[${name}] abandoned at shutdown after ${graceMs}ms grace`);
    }
    return { abandoned };
  }

  async function tick(now = new Date()): Promise<void> {
    const enabled = await deps.readConfig('jobs.enabled') as boolean;
    const order = await deps.readConfig('jobs.order') as string[];
    if (!Array.isArray(order) || order.some(name => typeof name !== 'string')) throw new Error('Background job priority order is invalid.');
    const priority = (job: Job) => { const index = order.indexOf(job.name); return index < 0 ? order.length : index; };
    const orderedJobs = [...selectedJobs].sort((a, b) => priority(a) - priority(b));
    const maxConcurrent = await deps.readConfig('sync.maxConcurrentJobs') as number;
    const retryLimit = await deps.readConfig('sync.retryLimit') as number;
    const retryBaseDelayMs = await deps.readConfig('sync.retryBaseDelayMs') as number;
    const retryMaxDelayMs = await deps.readConfig('sync.retryMaxDelayMs') as number;
    const leaseMinutes = await deps.readConfig('sync.workerLeaseMinutes') as number;
    const renewalDivisor = await deps.readConfig('sync.workerLeaseRenewalDivisor') as number;
    const errorLimit = await deps.readConfig('logging.workerErrorMaxCharacters') as number;
    const summaryLimit = await deps.readConfig('logging.workerSummaryMaxCharacters') as number;
    const heartbeatSeconds = await deps.readConfig('sync.workerHeartbeatSeconds') as number;
    const workerPollSeconds = await deps.readConfig('sync.workerPollSeconds') as number;
    pollIntervalMs = Math.max(1, Math.trunc(workerPollSeconds)) * SECOND_MS;
    const retryBackoff = { baseDelayMs: Math.max(1, Math.trunc(retryBaseDelayMs)), maxDelayMs: Math.max(1, Math.trunc(retryMaxDelayMs)) };
    const leaseMs = Math.max(1, Math.trunc(leaseMinutes)) * MINUTE_MS;
    if (enabled && !stopping) {
      let available = Math.max(0, Math.trunc(maxConcurrent) - running.size);
      for (const job of orderedJobs) {
        if (!available) break;
        const expression = await deps.readConfig(job.configKey) as string;
        if (!cronMatches(expression, now)) continue;
        if (running.has(job.name)) continue;
        void launch(job, now, Math.max(0, Math.trunc(retryLimit)), retryBackoff, leaseMs, renewalDivisor, errorLimit, summaryLimit).catch(error => log(`could not start ${job.name}`, error));
        // Lease acquisition is async; reserve a local slot before its result.
        available--;
      }
    }
    if (options.heartbeat !== false && Date.now() - lastHeartbeat >= Math.max(1, Math.trunc(heartbeatSeconds)) * SECOND_MS) {
      lastHeartbeat = Date.now();
      await deps.writeHeartbeat(owner, enabled ? selectedJobs.map(job => job.name) : [], now).catch(error => log('worker heartbeat failed', error));
    }
  }

  return { tick, runNow, shutdown, get running() { return new Set(running); }, get pollIntervalMs() { return pollIntervalMs; } };
}

export const workerConfigKeys = jobs.map(job => job.configKey);
