import { constants } from 'node:fs';
import { access, lstat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { CONFIG_REGISTRY } from '@/lib/config/registry';
import { configurationOwner } from '@/lib/config/ownership';
import { runtimeConfig, runtimeSecret } from '@/server/config/store';
import { prisma } from '@/server/data';
import { encryptSecret, decryptSecret } from '@/server/secret-crypto';
import { loadRootOperations } from '@/server/root/operations';
import { PLATFORM_HOSTS } from '@/server/platforms';
import { diagnosticScope } from '@/lib/diagnostics';
import { fail, pass, skipped, type DiagnosticDefinition } from './types';

export async function diagnosticChecks(actorId: string, scopeId: string, connectionId?: string): Promise<DiagnosticDefinition[]> {
  const scope = diagnosticScope(scopeId)!;
  const owner = scope.owner;
  const configuration: DiagnosticDefinition = { id: 'configuration', label: 'Configuration validation', async run(signal) {
    const entries = CONFIG_REGISTRY.filter(entry => {
      const candidate = configurationOwner(entry.key);
      return candidate.kind === owner.kind && (candidate.kind === 'shared' || owner.kind !== 'shared' && candidate.id === owner.id);
    });
    // Read each persisted value through its strict runtime validator; no values leave this check.
    for (const entry of entries) {
      signal?.throwIfAborted();
      try {
        if (entry.kind === 'secret') { const value = await runtimeSecret(entry.key); if (value !== null && !entry.schema.safeParse(value).success) return fail('invalid_secret', `${entry.label} (${entry.key}) does not match its registered format. Review this module’s settings.`); }
        else await runtimeConfig(entry.key);
      } catch { return fail('invalid_configuration', `${entry.label} (${entry.key}) could not be validated. Review its saved value or secret encryption.`); }
    }
    return pass('configuration_valid', 'Registered values validate; saved secrets can be decrypted. Missing optional values and provider grants are checked separately.');
  } };
  if (owner.kind === 'platform') {
    const hooks = (PLATFORM_HOSTS as Record<string, import('@/server/platforms/host').PlatformHost>)[owner.id]?.diagnostics;
    return [configuration, ...(hooks ? await hooks.checks(connectionId) : [{ id: 'provider', label: 'Provider API', run: async () => skipped('not_implemented', 'This adapter does not yet provide API diagnostics.') }])];
  }
  const worker: DiagnosticDefinition = { id: 'worker', label: 'Replacement worker activity', async run() {
    const health = await loadRootOperations(actorId, owner.kind === 'product' ? owner.id : undefined);
    if (!health.jobs.length) return skipped('no_background_jobs', 'This module declares no background jobs.');
    if (!health.enabled) return skipped('jobs_disabled', 'Background execution is disabled in Shared configuration.');
    if (health.worker.state !== 'fresh') return fail('worker_unavailable', 'No recent replacement-worker heartbeat. Check the worker service before relying on scheduled work.');
    const latest = health.jobs.map(job => health.runs.find(run => run.job === job.name));
    if (latest.some(run => run?.outcome === 'failed')) return fail('job_failed', 'At least one latest recorded job failed. Inspect replacement-worker logs securely.');
    if (latest.some(run => !run || run.outcome !== 'ok')) return skipped('coverage_incomplete', 'Heartbeat is recent, but successful run evidence is incomplete. Review Operations.');
    return pass('worker_recent', 'Recent replacement-worker heartbeat and successful latest recorded attempts. This does not prove provider delivery.');
  } };
  if (owner.kind === 'product') return [configuration, worker];
  return [
    { id: 'database', label: 'Database read connectivity', async run() {
      const timeout = await runtimeConfig('diagnostics.databaseTimeoutMs');
      await prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT set_config('statement_timeout', ${String(timeout)}, true)`;
        await tx.$queryRaw`SELECT 1`;
      }, { timeout, maxWait: timeout });
      return pass('database_read', 'Authenticated database query completed. Audit writes are verified separately by this run’s recorded receipt.');
    } }, configuration,
    { id: 'encryption', label: 'Secret encryption round trip', async run() {
      const nonce = randomUUID();
      return decryptSecret(encryptSecret(nonce)) === nonce ? pass('encryption_valid', 'In-memory authenticated encryption and decryption succeeded. Existing saved secrets require their module checks.') : fail('encryption_invalid', 'Encryption round trip did not match.');
    } },
    { id: 'storage', label: 'Media directory permissions', async run() {
      const root = await runtimeConfig('storage.mediaRoot');
      if (!root) return skipped('storage_unconfigured', 'Set the media storage root before testing directory access.');
      const stats = await lstat(root);
      if (!stats.isDirectory() || stats.isSymbolicLink()) return fail('storage_invalid', 'Configured media root must be a real directory.');
      await access(root, constants.R_OK | constants.W_OK | constants.X_OK);
      return pass('storage_accessible', 'Media directory permits reading, writing and traversal. File upload, available space and remote storage are not verified by this permission check.');
    } }, worker,
  ];
}
