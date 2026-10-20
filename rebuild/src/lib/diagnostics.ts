import { synchronousPolicy, withinSynchronousLimit } from '@/lib/config/synchronous-policy';
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
export const diagnosticInput = z.object({ scope: z.string().refine(value => Boolean(diagnosticScope(value))), connectionId: z.string().min(1).refine(withinSynchronousLimit('root.identifierMaxCharacters')).optional(), confirmation: z.string().min(1).refine(withinSynchronousLimit('diagnostics.confirmationMaxCharacters')) }).strict();
export const diagnosticCheckSchema = z.object({
  id: z.string().min(1).refine(withinSynchronousLimit('diagnostics.identifierMaxCharacters')), label: z.string().min(1).refine(withinSynchronousLimit('diagnostics.labelMaxCharacters')), status: z.enum(['pass', 'fail', 'skipped']),
  code: z.string().min(1).refine(withinSynchronousLimit('diagnostics.codeMaxCharacters')), message: z.string().refine(withinSynchronousLimit('diagnostics.messageMaxCharacters')), durationMs: z.number().int().nonnegative().safe(),
}).strict();
export const diagnosticRunSchema = z.object({
  id: z.string().min(1).refine(withinSynchronousLimit('diagnostics.identifierMaxCharacters')), scope: z.string().refine(value => Boolean(diagnosticScope(value))), connectionId: z.string().refine(withinSynchronousLimit('root.identifierMaxCharacters')).nullable(),
  startedAt: z.string().datetime(), finishedAt: z.string().datetime(), checks: z.array(diagnosticCheckSchema).refine(value => value.length <= synchronousPolicy('diagnostics.checksMaxItems')),
}).strict();
export type DiagnosticCheck = z.infer<typeof diagnosticCheckSchema>;
export type DiagnosticRun = z.infer<typeof diagnosticRunSchema>;
export type DiagnosticReceipt = DiagnosticRun & { auditRecorded: boolean; warning?: string };
