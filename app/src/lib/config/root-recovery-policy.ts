import { z } from 'zod';
import { SYNCHRONOUS_POLICY } from './synchronous-policy';

export type RootRecoveryLimits = { identifierMaxCharacters: number; confirmationMaxCharacters: number };
/** Compatibility defaults only; live Root screens pass the service's runtimeConfig values. */
export const ROOT_RECOVERY_LIMITS: RootRecoveryLimits = {
  identifierMaxCharacters: SYNCHRONOUS_POLICY['root.identifierMaxCharacters'].defaultValue,
  confirmationMaxCharacters: SYNCHRONOUS_POLICY['root.confirmationMaxCharacters'].defaultValue,
};
export function rootRecoveryFields(limits: RootRecoveryLimits) {
  return {
    operationId: z.string().min(1).max(limits.identifierMaxCharacters).regex(/^[A-Za-z0-9_-]+$/),
    confirmation: z.string().max(limits.confirmationMaxCharacters),
  };
}
