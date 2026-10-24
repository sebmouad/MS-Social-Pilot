import { ROOT_ADMIN_CONFIG } from './server/admin/config';
import { z } from 'zod';
import { entry, cron } from '@/lib/config/entry';
import { rootMonitoringSurfaceConfig } from './monitoring-config';
import { rootApiUsageConfig } from './api-usage-config';

export const monitoringPolicySchema = z.object({
  chatWorkspaceId: z.string().trim().default(''),
  deliveryBatchSize: z.number().int().min(1).max(1000),
  deliveryLeaseSeconds: z.number().int().min(60).max(3600),
  workerStaleSeconds: z.number().int().min(30).max(86400),
  publishFailureWindowSeconds: z.number().int().min(60).max(604800),
  publishFailureThreshold: z.number().int().min(1).max(100000),
  tokenExpiryWarningDays: z.number().int().min(1).max(365),
  diskPath: z.string().min(1).max(4096),
  diskUsedPercent: z.number().min(1).max(100),
  healthUrl: z.string().url().refine(value => new URL(value).pathname === '/api/health'),
  healthTimeoutMs: z.number().int().min(100).max(60000),
  historyDays: z.number().int().min(1).max(730),
  alertLimit: z.number().int().min(1).max(1000),
}).strict();
export const monitoringMailCopy = { en: { open: 'Installation alert opened', resolved: 'Installation alert resolved', test: 'Installation alert delivery test', body: 'Review installation monitoring in Root. Signal: {key}' }, fr: { open: 'Alerte de l’installation ouverte', resolved: 'Alerte de l’installation résolue', test: 'Test d’envoi des alertes de l’installation', body: 'Consultez la surveillance de l’installation dans Root. Signal : {key}' } };
export const mailCopySchema = z.object({ en: z.object({ test: z.string().min(1).default(monitoringMailCopy.en.test), open: z.string().min(1), resolved: z.string().min(1), body: z.string().min(1) }), fr: z.object({ test: z.string().min(1).default(monitoringMailCopy.fr.test), open: z.string().min(1), resolved: z.string().min(1), body: z.string().min(1) }) });
export const ROOT_MONITORING_CONFIG = [...ROOT_ADMIN_CONFIG, entry({ key: 'root.monitoring.watchdogEnabled', group: 'Root · Monitoring', label: 'Web process monitoring watchdog', kind: 'boolean', description: 'Start independent leased monitoring from the web process. Rechecked on every observer tick; disabling stops new monitoring claims without a web restart.', defaultValue: true, schema: z.boolean(), consumption: 'active' }), entry({ key: 'root.monitoringMailCopy', group: 'Root · Monitoring', label: 'Alert email copy', kind: 'json', description: 'English and French installation incident notifications.', defaultValue: monitoringMailCopy, schema: mailCopySchema, consumption: 'active' }), ...rootMonitoringSurfaceConfig, ...rootApiUsageConfig, entry({ key: 'root.monitoring.schedule', group: 'Root · Monitoring', label: 'Installation monitoring interval', kind: 'text', description: 'Cron schedule for leased installation monitoring jobs.', defaultValue: '* * * * *', schema: cron, consumption: 'active' }), entry({
  key: 'root.monitoringPolicy', group: 'Root · Monitoring', label: 'Installation monitoring policy', kind: 'json',
  description: 'Alert thresholds, worker freshness, app health probe and uptime history bounds. Optional chatWorkspaceId selects exactly one workspace owned by the active installation owner; empty disables operator chat notifications. App uptime is counted only after a successful health probe; records are sampled minutes, not continuous availability proof.',
  defaultValue: monitoringPolicySchema.parse({ deliveryBatchSize: 20, deliveryLeaseSeconds: 300, workerStaleSeconds: 120, publishFailureWindowSeconds: 3600, publishFailureThreshold: 5, tokenExpiryWarningDays: 7, diskPath: '/', diskUsedPercent: 90, healthUrl: 'http://127.0.0.1:3100/api/health', healthTimeoutMs: 5000, historyDays: 90, alertLimit: 50 }),
  schema: monitoringPolicySchema, consumption: 'active',
})] as const;
