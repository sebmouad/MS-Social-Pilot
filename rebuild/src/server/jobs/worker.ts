import { randomUUID } from 'node:crypto';
import { prisma } from '@/server/data';
import { runtimeConfig } from '@/server/config/store';
import { cronMatches } from './cron';

export type JobName = 'posts' | 'analytics' | 'inbox';
export type WorkerLogger = (message: string, detail?: unknown) => void;
const LEASE_MS = 5 * 60_000;
const HEARTBEAT_MS = 30_000;
type Job = { name: JobName; configKey: string };
const jobs: Job[] = [
  { name: 'posts', configKey: 'sync.posts.schedule' },
  { name: 'analytics', configKey: 'sync.analytics.schedule' },
  { name: 'inbox', configKey: 'sync.inbox.schedule' },
];

export type WorkerDependencies = {
  readConfig: (key: string) => Promise<unknown>;
  execute: (job: JobName, now: Date, retryLimit: number) => Promise<string>;
  tryLease: (job: JobName, owner: string, token: string, until: Date) => Promise<boolean>;
  renewLease: (job: JobName, token: string, until: Date) => Promise<boolean>;
  releaseLease: (job: JobName, token: string) => Promise<void>;
  writeRun: (input: { id: string; job: JobName; owner: string; startedAt: Date; finishedAt: Date; outcome: string; attempts: number; summary?: string; error?: string }) => Promise<void>;
  writeHeartbeat: (owner: string, jobs: JobName[], at: Date) => Promise<void>;
  alreadyRanThisMinute: (job: JobName, from: Date, until: Date) => Promise<boolean>;
  logger: WorkerLogger;
};

export function createWorker(deps: WorkerDependencies, owner: string) {
  const startedMinute = new Map<JobName, number>();
  const running = new Set<JobName>();
  let lastHeartbeat = 0;

  async function launch(job: Job, now: Date, retryLimit: number): Promise<void> {
    if (running.has(job.name)) return;
    const minuteStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), now.getMinutes());
    const minuteEnd = new Date(minuteStart.getTime() + 60_000);
    if (startedMinute.get(job.name) === minuteStart.getTime()) return;
    if (await deps.alreadyRanThisMinute(job.name, minuteStart, minuteEnd)) {
      startedMinute.set(job.name, minuteStart.getTime());
      return;
    }
    startedMinute.set(job.name, minuteStart.getTime());
    running.add(job.name);
    const token = randomUUID();
    let acquired: boolean;
    try { acquired = await deps.tryLease(job.name, owner, token, new Date(Date.now() + LEASE_MS)); }
    catch (error) { running.delete(job.name); throw error; }
    if (!acquired) { running.delete(job.name); return; }
    const startedAt = new Date();
    let attempts = 0;
    let outcome = 'ok';
    let summary: string | undefined;
    let errorText: string | undefined;
    const renew = setInterval(() => {
      void deps.renewLease(job.name, token, new Date(Date.now() + LEASE_MS)).then(renewed => {
        if (!renewed) deps.logger(`lease for ${job.name} is no longer owned by this worker`);
      }).catch(error => deps.logger(`lease renewal failed for ${job.name}`, error));
    }, Math.floor(LEASE_MS / 3));
    try {
      attempts = 1;
      summary = await deps.execute(job.name, new Date(), retryLimit);
      if (/failed=[1-9]/.test(summary)) { outcome = 'failed'; errorText = `Some workspace sync items failed: ${summary}`; }
      deps.logger(`[${job.name}] ${summary}`);
    } catch (error) {
      outcome = 'failed';
      errorText = (error instanceof Error ? error.message : String(error)).slice(0, 2000);
      deps.logger(`[${job.name}] failed: ${errorText}`);
    } finally {
      clearInterval(renew);
      const finishedAt = new Date();
      await deps.writeRun({ id: randomUUID(), job: job.name, owner, startedAt, finishedAt, outcome, attempts, ...(summary ? { summary: summary.slice(0, 2000) } : {}), ...(errorText ? { error: errorText } : {}) }).catch(error => deps.logger(`run audit write failed for ${job.name}`, error));
      await deps.releaseLease(job.name, token).catch(error => deps.logger(`lease release failed for ${job.name}`, error));
      running.delete(job.name);
    }
  }

  async function tick(now = new Date()): Promise<void> {
    const enabled = await deps.readConfig('jobs.enabled') as boolean;
    const maxConcurrent = await deps.readConfig('sync.maxConcurrentJobs') as number;
    const retryLimit = await deps.readConfig('sync.retryLimit') as number;
    if (enabled) {
      let available = Math.max(0, Math.trunc(maxConcurrent) - running.size);
      for (const job of jobs) {
        if (!available) break;
        const expression = await deps.readConfig(job.configKey) as string;
        if (!cronMatches(expression, now)) continue;
        if (running.has(job.name)) continue;
        void launch(job, now, Math.max(0, Math.trunc(retryLimit))).catch(error => deps.logger(`could not start ${job.name}`, error));
        // Lease acquisition is async; reserve a local slot before its result.
        available--;
      }
    }
    if (Date.now() - lastHeartbeat >= HEARTBEAT_MS) {
      lastHeartbeat = Date.now();
      await deps.writeHeartbeat(owner, enabled ? jobs.map(job => job.name) : [], now).catch(error => deps.logger('worker heartbeat failed', error));
    }
  }

  return { tick, get running() { return new Set(running); } };
}

export const workerConfigKeys = jobs.map(job => job.configKey);
