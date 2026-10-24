import { beforeEach, describe, expect, it, vi } from 'vitest';
import { customerCopy as tasksCopy, customerCopySchema as tasksSchema, uiCopy as taskText } from '@/modules/tasks/ui/copy';
import { customerCopy as agencyCopy, customerCopySchema as agencySchema, uiCopy as agencyText } from '@/modules/agency/ui/copy';
import { agencyExportCatalog, agencyExportCopy, agencyExportCopySchema } from '@/modules/agency/export-copy';
const mocks = vi.hoisted(() => ({ config: vi.fn() }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: mocks.config }));
import { executeTasksTool } from '@/modules/tasks/mcp';
import { executeAgencyTool } from '@/modules/agency/mcp';
import { withCustomerCopy as taskRequest, copyError as taskError } from '@/modules/tasks/server/copy';
import { withCustomerCopy as agencyRequest, copyError as agencyError, loadExportCopy } from '@/modules/agency/server/copy';

beforeEach(() => { vi.clearAllMocks(); });

describe('Tasks and Agency customer catalogs', () => {
  it.each([[tasksCopy, tasksSchema], [agencyCopy, agencySchema]] as const)('requires every English and French entry and rejects unknown keys', (copy, schema) => {
    expect(schema.safeParse(copy).success).toBe(true);
    expect(schema.safeParse({ ...copy, unknown: { en: 'New', fr: 'Nouveau' } }).success).toBe(false);
    const [key] = Object.keys(copy);
    expect(schema.safeParse({ ...copy, [key!]: { en: 'Present' } }).success).toBe(false);
    expect(schema.safeParse({ ...copy, [key!]: { en: '', fr: 'Présent' } }).success).toBe(false);
  });
  it('renders configured English and French labels and parameterized errors', () => {
    const copy = structuredClone(tasksCopy);
    copy.Tasks = { en: 'Work', fr: 'Travail' };
    copy['Due dates can be at most {0} days apart.'] = { en: 'Space dates by at most {0} days.', fr: 'Espacez les dates de {0} jours au maximum.' };
    expect(taskText('en', copy)('Tasks')).toBe('Work');
    expect(taskText('fr', copy)('Tasks')).toBe('Travail');
    expect(taskText('fr', copy)('The task title is longer than 20 characters.')).toBe('Le champ titre de la tâche dépasse 20 caractères.');
    expect(taskText('fr', copy)('Space dates by at most 7 days.')).toBe('Espacez les dates de 7 jours au maximum.');
    expect(agencyText('fr')('Search text can be at most 20 characters.')).toBe('Le texte de recherche peut contenir au maximum 20 caractères.');
  });
  it('loads Tasks once for nested service calls and retains isolated concurrent snapshots', async () => {
    const a = structuredClone(tasksCopy); const b = structuredClone(tasksCopy);
    a['Choose a valid task request.'].en = 'Review request A.';
    b['Choose a valid task request.'].en = 'Review request B.';
    mocks.config.mockResolvedValueOnce(a).mockResolvedValueOnce(b);
    const values = await Promise.all([taskRequest(() => taskRequest(async () => { await Promise.resolve(); return taskError('invalid_request', 'Choose a valid task request.').message; })), taskRequest(async () => taskError('invalid_request', 'Choose a valid task request.').message)]);
    expect(values).toEqual(['Review request A.', 'Review request B.']);
    expect(mocks.config.mock.calls).toEqual([['tasks.customerCopy'], ['tasks.customerCopy']]);
  });
  it('applies the same Root copy to early Tasks and Agency MCP errors', async () => {
    const tasks = structuredClone(tasksCopy); const agency = structuredClone(agencyCopy);
    tasks['Choose a valid task.'].en = 'Review the selected task.';
    agency['Agency tools are available only to a signed-in person, not to a workspace key.'].en = 'Use your personal access.';
    mocks.config.mockResolvedValueOnce(tasks).mockResolvedValueOnce(agency);
    await expect(executeTasksTool({ userId: 'u', workspaceId: 'w' }, 'get_task', {})).rejects.toMatchObject({ code: 'invalid_request', message: 'Review the selected task.' });
    await expect(executeAgencyTool({ scope: 'workspace' }, 'get_agency_overview', {})).rejects.toMatchObject({ code: 'forbidden', message: 'Use your personal access.' });
  });
  it('uses the Agency request catalog for shared service failures and the export setting for downloads', async () => {
    const copy = structuredClone(agencyCopy);
    copy['Choose valid agency filters.'].en = 'Review these filters.';
    const exports = structuredClone(agencyExportCopy);
    mocks.config.mockResolvedValueOnce(copy).mockResolvedValueOnce(agencyExportCatalog);
    expect(await agencyRequest(async () => agencyError('invalid_request', 'Choose valid agency filters.').message)).toBe('Review these filters.');
    expect(await loadExportCopy()).toEqual(exports);
    expect(agencyExportCopySchema.safeParse(agencyExportCatalog).success).toBe(true);
    expect(agencyExportCopySchema.safeParse({ ...agencyExportCatalog, csv: { ...agencyExportCatalog.csv, fr: '' } }).success).toBe(false);
  });
});
