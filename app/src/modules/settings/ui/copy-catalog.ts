import { z } from 'zod';
import { copySchema as flatCopySchema } from '@/lib/config/copy-schema';
import { accountCopy } from './account/copy';
import { connectionsCopy } from './connections/copy';
import { dataCopy } from './data/copy';
import { exportCopy } from './data/export-copy';
import { mcpCopy } from './mcp/copy';
import { notificationsCopy } from './notifications/copy';
import { teamCopy, invitationCopy, teamRoleCopy } from './team/copy';
import { workspacePolicyCopy } from './workspace/copy';
import { workspaceOperationsCopy } from '../workspace-operations-copy';
import { profileCopy } from '../channel-profiles/copy';
import { shellCopy } from './shell-copy';
import { personKeyCopy } from '../person-keys/copy';
import { notificationPreferenceLabels } from '../notifications/catalog';
import { securityCopy } from './account/security-copy';

export const settingsUiCopy = { personKeys: personKeyCopy, notificationLabels: notificationPreferenceLabels, account: accountCopy, connections: connectionsCopy, data: dataCopy, exports: exportCopy, mcp: mcpCopy, notifications: notificationsCopy, team: teamCopy, invitations: invitationCopy, roles: teamRoleCopy, workspace: workspacePolicyCopy, operations: workspaceOperationsCopy, profiles: profileCopy, shell: shellCopy, security: securityCopy };
type Widen<T> = T extends string ? string : T extends readonly (infer V)[] ? readonly Widen<V>[] : { -readonly [K in keyof T]: Widen<T[K]> };
export type SettingsUiCopy = Widen<typeof settingsUiCopy>;
/** Exact catalog shape, including positional day arrays; unknown/missing keys are rejected. */
export function copySchema(value: unknown): z.ZodTypeAny {
  if (typeof value === 'string') return z.string().trim().min(1);
  if (Array.isArray(value)) return z.array(copySchema(value[0])).length(value.length);
  if (Object.values(value as Record<string, unknown>).every(item => typeof item === 'string')) return flatCopySchema(value as Record<string, string>);
  return z.object(Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, copySchema(item)]))).strict();
}
export const settingsUiCopySchema = copySchema(settingsUiCopy) as z.ZodType<SettingsUiCopy>;
