import { withinSynchronousLimit } from '@/lib/config/synchronous-policy';
import { z } from 'zod';

export const rootUserActions = ['disable', 'enable', 'sign-out', 'reset-two-step'] as const;
export type RootUserAction = typeof rootUserActions[number];

export const rootUserIdSchema = z.string().min(1).refine(withinSynchronousLimit('root.identifierMaxCharacters'));
export const rootUserConfirmationSchema = z.string().min(1).refine(withinSynchronousLimit('root.confirmationMaxCharacters'));

/** Confirmation copy shared by the Root user UI and the mutation service. */
export function rootUserConfirmation(action: RootUserAction, email: string) {
  switch (action) {
    case 'disable': return `DISABLE ${email}`;
    case 'enable': return `ENABLE ${email}`;
    case 'sign-out': return `SIGN OUT ${email}`;
    case 'reset-two-step': return `RESET TWO-STEP ${email}`;
  }
}
