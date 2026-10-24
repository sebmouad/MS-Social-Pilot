import { describe, expect, it } from 'vitest';
import { accountCopy } from '@/modules/settings/ui/account/copy';
import { appearanceCopy } from '@/modules/settings/ui/appearance/copy';
import { connectionsCopy } from '@/modules/settings/ui/connections/copy';
import { dataCopy } from '@/modules/settings/ui/data/copy';
import { exportCopy } from '@/modules/settings/ui/data/export-copy';
import { mcpCopy } from '@/modules/settings/ui/mcp/copy';
import { notificationsCopy } from '@/modules/settings/ui/notifications/copy';
import { shellCopy } from '@/modules/settings/ui/shell-copy';
import { invitationCopy, teamCopy, teamRoleCopy } from '@/modules/settings/ui/team/copy';
import { workspacePolicyCopy } from '@/modules/settings/ui/workspace/copy';
import { workspaceOperationsCopy } from '@/modules/settings/workspace-operations-copy';
import { profileCopy } from '@/modules/settings/channel-profiles/copy';
import { personKeyCopy } from '@/modules/settings/person-keys/copy';
import { notificationPreferenceLabels } from '@/modules/settings/notifications/catalog';

type Tree = { en: unknown; fr: unknown };
const tables: Record<string, Tree> = {
  account: accountCopy, appearance: appearanceCopy, connections: connectionsCopy, data: dataCopy, exports: exportCopy,
  mcp: mcpCopy, notifications: notificationsCopy, shell: shellCopy, team: teamCopy, invitations: invitationCopy, teamRoles: teamRoleCopy,
  workspacePolicy: workspacePolicyCopy, workspaceOperations: workspaceOperationsCopy, profiles: profileCopy, personKeys: personKeyCopy,
  notificationPreferences: notificationPreferenceLabels as Tree,
};

/** Flattens a copy tree to `path -> string` leaves so keys and placeholders can be compared. */
function leaves(value: unknown, path = ''): Map<string, string> {
  const out = new Map<string, string>();
  if (typeof value === 'string') out.set(path, value);
  else if (Array.isArray(value)) value.forEach((item, index) => leaves(item, `${path}[${index}]`).forEach((text, key) => out.set(key, text)));
  else if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) leaves(child, path ? `${path}.${key}` : key).forEach((text, name) => out.set(name, text));
  return out;
}
const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();

describe('settings copy tables', () => {
  for (const [name, table] of Object.entries(tables)) {
    describe(name, () => {
      const en = leaves(table.en);
      const fr = leaves(table.fr);
      it('has the same keys in English and French', () => {
        expect([...fr.keys()].sort()).toEqual([...en.keys()].sort());
      });
      it('uses the same placeholders in both languages', () => {
        for (const [key, text] of en) expect(placeholders(fr.get(key) ?? ''), key).toEqual(placeholders(text));
      });
      it('has no empty French text', () => {
        for (const [key, text] of fr) expect(text.trim(), key).not.toBe('');
      });
    });
  }
});
