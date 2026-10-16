import { z } from 'zod';
import { moduleManifests } from '@/modules';
import { PLATFORM_MODULES } from '@/platforms';
import type { ConfigurationOwner } from '@/lib/config/ownership';

export const diagnosticScopes = [
  { id: 'shared', label: 'Shared infrastructure', owner: { kind: 'shared' } },
  ...moduleManifests.map(module => ({ id: `product:${module.id}`, label: module.title, owner: { kind: 'product', id: module.id } })),
  ...PLATFORM_MODULES.map(module => ({ id: `platform:${module.id}`, label: module.name, owner: { kind: 'platform', id: module.id } })),
] as readonly { id: string; label: string; owner: ConfigurationOwner }[];
export const diagnosticScope = (id: string) => diagnosticScopes.find(scope => scope.id === id);
export const diagnosticConfirmation = (scope: string) => `RUN DIAGNOSTICS ${scope}`;
export const diagnosticInput = z.object({ scope: z.string().refine(value => Boolean(diagnosticScope(value))), connectionId: z.string().min(1).max(200).optional(), confirmation: z.string().min(1).max(300) }).strict();
export const diagnosticCheckSchema = z.object({
  id: z.string().min(1).max(100), label: z.string().min(1).max(160), status: z.enum(['pass', 'fail', 'skipped']),
  code: z.string().min(1).max(100), message: z.string().max(500), durationMs: z.number().int().nonnegative().safe(),
}).strict();
export const diagnosticRunSchema = z.object({
  id: z.string().min(1).max(100), scope: z.string().refine(value => Boolean(diagnosticScope(value))), connectionId: z.string().max(200).nullable(),
  startedAt: z.string().datetime(), finishedAt: z.string().datetime(), checks: z.array(diagnosticCheckSchema).max(100),
}).strict();
export type DiagnosticCheck = z.infer<typeof diagnosticCheckSchema>;
export type DiagnosticRun = z.infer<typeof diagnosticRunSchema>;
export type DiagnosticReceipt = DiagnosticRun & { auditRecorded: boolean; warning?: string };
