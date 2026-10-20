/** Client-safe stored-evidence declarations; never executable provider probes. */
export interface ModuleHealthDeclaration {
  readonly configuration: boolean;
  readonly jobHistory: boolean;
  readonly pendingQueues: readonly ('scheduledPosts' | 'publicationAttempts' | 'workspaceExports')[];
}
export type HealthStatus = 'pass' | 'fail' | 'unknown';
