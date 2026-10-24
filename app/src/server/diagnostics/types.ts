import type { DiagnosticCheck } from '@/lib/diagnostics';
export type CheckOutcome = Pick<DiagnosticCheck, 'status' | 'code' | 'message'>;
export interface DiagnosticDefinition {
  id: string;
  label: string;
  run(signal?: AbortSignal): Promise<CheckOutcome>;
}
/** Installed provider hooks are private operator checks, independent of customer enablement. */
export interface PlatformDiagnostics {
  checks(connectionId?: string): Promise<DiagnosticDefinition[]>;
}
export const pass = (code: string, message: string): CheckOutcome => ({ status: 'pass', code, message });
export const fail = (code: string, message: string): CheckOutcome => ({ status: 'fail', code, message });
export const skipped = (code: string, message: string): CheckOutcome => ({ status: 'skipped', code, message });
