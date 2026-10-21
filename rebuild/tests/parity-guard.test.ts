import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const state = vi.hoisted(() => ({
  actor: vi.fn(), currentRoot: vi.fn(), directory: vi.fn(), owner: vi.fn(), create: vi.fn(), workspace: vi.fn(), rename: vi.fn(), audit: vi.fn(),
}));
vi.mock('@/server/config/access', () => ({ currentRootActor: state.currentRoot }));
vi.mock('@/server/root/directory', () => ({ listRootWorkspaces: state.directory }));
vi.mock('@/server/data', () => ({ prisma: {
  user: { findUnique: state.actor },
  $transaction: async (run: (tx: unknown) => unknown) => run({
    user: { findUnique: state.owner },
    workspace: { create: state.create, findUnique: state.workspace, updateMany: state.rename },
    $executeRaw: state.audit,
  }),
} }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: async (key: string) => {
  if (key === 'root.workspaceNameMaxCharacters') return 80;
  if (key === 'root.identifierMaxCharacters') return 200;
  if (key === 'root.defaultWorkspaceTimezone') return 'Africa/Casablanca';
  return 10;
} }));
import { moduleManifests } from '@/modules';
import { installedMcpGroups } from '@/modules/installed-mcp';
import { agencyPersonTools } from '@/modules/agency/person-mcp';
import { GET as workspaceDirectory } from '@/app/api/root/workspaces/route';
import { rootToolDefinitions, rootResources, rootResourceTool, runRootTool } from '@/server/mcp/root-tools';

// The documentation is the explicit review policy, never inferred from current tools/routes.
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const policy = readFileSync(join(root, 'docs/MCP_PARITY.md'), 'utf8');
const methods = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);
type Tool = { name: string; feature: string; access: string };
type Mapping = Tool & { routes: string[]; reason: string };
type Exception = { id: string; reason: string };

function table(document: string, name: string, columns: number): string[][] {
  const start = `<!-- parity-${name}:start -->`, end = `<!-- parity-${name}:end -->`;
  if (document.split(start).length !== 2 || document.split(end).length !== 2) throw new Error(`Missing/duplicate ${name} policy table`);
  const section = document.split(start)[1].split(end)[0];
  return section.split('\n').filter(line => line.startsWith('|')).slice(2).map(line => {
    const cells = line.split('|').slice(1, -1).map(cell => cell.trim());
    if (cells.length !== columns || cells.some(cell => !cell)) throw new Error(`Malformed ${name} row: ${line}`);
    return cells;
  });
}
const mappings: Mapping[] = table(policy, 'tools', 5).map(([name, feature, access, routes, reason]) => ({ name, feature, access, routes: routes.split('; '), reason }));
const rootMappings: Mapping[] = table(policy, 'root-tools', 5).map(([name, feature, access, routes, reason]) => ({ name, feature, access, routes: routes.split('; '), reason }));
const aliases = table(policy, 'rest-aliases', 3).map(([route, tools, reason]) => ({ route, tools: tools.split(', '), reason }));
const exceptions: Exception[] = table(policy, 'rest-exceptions', 2).map(([id, reason]) => ({ id, reason }));
const featureAliases = table(policy, 'feature-aliases', 3).map(([feature, target, reason]) => ({ feature, target, reason }));

/** Parse exports rather than matching words in comments, strings or imported handler bodies. */
function exportedMethods(source: string): string[] {
  const file = ts.createSourceFile('route.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const result: string[] = [];
  for (const statement of file.statements) {
    if (ts.isExportDeclaration(statement) && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
      for (const element of statement.exportClause.elements) if (!statement.isTypeOnly && !element.isTypeOnly && methods.has(element.name.text)) result.push(element.name.text);
    } else if (ts.canHaveModifiers(statement) && ts.getModifiers(statement)?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)) {
      if (ts.isFunctionDeclaration(statement) && statement.name && methods.has(statement.name.text)) result.push(statement.name.text);
      if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          if (ts.isIdentifier(declaration.name) && methods.has(declaration.name.text)) result.push(declaration.name.text);
        }
      }
    }
  }
  if (file.statements.some(statement => ts.isExportDeclaration(statement) && !statement.exportClause)) throw new Error('Export-star routes need an explicit reviewed handler export');
  return result.sort();
}
function scanRoutes(directory: string): string[] {
  const api = directory;
  function visit(folder: string): string[] {
    return readdirSync(folder, { withFileTypes: true }).flatMap(entry => {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) return visit(path);
      if (!/^route\.(?:ts|tsx|js|jsx|mts|mjs)$/.test(entry.name)) return [];
      // Route groups do not appear in public URLs. Fail closed on duplicate URLs below.
      const segments = relative(api, dirname(path)).split(sep).filter(part => part && !/^\(.*\)$/.test(part));
      const url = ['/api', ...segments].join('/');
      const exports = exportedMethods(readFileSync(path, 'utf8'));
      if (!exports.length) throw new Error(`No explicit HTTP exports found: ${relative(root, path)}`);
      return exports.map(method => `${method} ${url}`);
    });
  }
  return visit(directory).sort();
}
function duplicateErrors(ids: string[], kind: string): string[] {
  return [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))].map(id => `Duplicate ${kind}: ${id}`);
}
function parityErrors(tools: Tool[], routes: string[], entries: Mapping[], restAliases: typeof aliases, excluded: Exception[]): string[] {
  const errors = [
    ...duplicateErrors(tools.map(tool => tool.name), 'tool'), ...duplicateErrors(routes, 'route'),
    ...duplicateErrors(entries.map(entry => entry.name), 'mapping'), ...duplicateErrors(restAliases.map(alias => alias.route), 'REST alias'),
    ...duplicateErrors(excluded.map(entry => entry.id), 'exception'),
  ];
  const toolByName = new Map(tools.map(tool => [tool.name, tool]));
  const routeSet = new Set(routes), covered = new Set<string>();
  for (const entry of entries) {
    const tool = toolByName.get(entry.name);
    if (!tool) errors.push(`Stale tool mapping: ${entry.name}`);
    else if (tool.feature !== entry.feature || tool.access !== entry.access) errors.push(`Changed feature/access: ${entry.name}`);
    if (!entry.reason.trim() || !entry.routes.length) errors.push(`Incomplete mapping: ${entry.name}`);
    for (const route of entry.routes) {
      if (!routeSet.has(route)) errors.push(`Missing REST counterpart: ${entry.name} -> ${route}`);
      covered.add(route);
    }
  }
  for (const tool of tools) if (!entries.some(entry => entry.name === tool.name)) errors.push(`Unmapped MCP tool: ${tool.name}`);
  for (const alias of restAliases) {
    if (!routeSet.has(alias.route)) errors.push(`Stale REST alias: ${alias.route}`);
    if (covered.has(alias.route)) errors.push(`Redundant REST alias: ${alias.route}`);
    if (!alias.reason.trim() || !alias.tools.length) errors.push(`Incomplete REST alias: ${alias.route}`);
    for (const name of alias.tools) if (!toolByName.has(name) || !entries.some(entry => entry.name === name)) errors.push(`Missing MCP counterpart: ${alias.route} -> ${name}`);
    covered.add(alias.route);
  }
  for (const exception of excluded) {
    if (!exception.reason.trim()) errors.push(`Exception requires a reason: ${exception.id}`);
    if (!routeSet.has(exception.id)) errors.push(`Stale REST exception: ${exception.id}`);
    if (covered.has(exception.id)) errors.push(`Mapped route also excepted: ${exception.id}`);
    covered.add(exception.id);
  }
  for (const route of routes) if (!covered.has(route)) errors.push(`Unmapped REST route: ${route}`);
  return errors;
}
const groups = installedMcpGroups();
const tools: Tool[] = groups.flatMap(group => group.tools.map(tool => ({ name: tool.name, feature: group.features[tool.name], access: [...(group.writeTools ?? [])].includes(tool.name) ? 'write' : 'read' })));
// Separate authority: importing its definitions does not install person tools in workspace groups.
tools.push(...agencyPersonTools.map(tool => ({ name: tool.name, feature: 'agency/overview', access: 'read' })));
// Root has its own private dispatcher rather than workspace feature/write declarations.
// Keep this reviewed classification independent of the documentation mapping.
const rootWrites = new Set([
  'revoke_root_invitation', 'resend_root_registration_verification', 'delete_root_unverified_registration',
  'update_root_plan', 'assign_root_plan', 'change_root_member_role', 'transfer_root_workspace_ownership',
  'refresh_root_connection', 'disconnect_root_connection', 'transfer_root_installation', 'delete_root_user',
  'delete_root_workspace', 'set_root_error_resolved', 'sign_out_root_session', 'confirm_root_inbox_deletion',
  'record_root_post_deletion_outcome', 'run_root_platform_publication_action', 'record_root_publication_outcome',
  'finish_root_publication_projection', 'adopt_root_legacy_publication', 'run_root_diagnostics', 'manage_root_user',
  'set_root_workspace_access', 'set_root_config', 'create_root_workspace', 'rename_root_workspace',
]);
const privateTools: Tool[] = rootToolDefinitions.map(tool => ({ name: tool.name, feature: 'installation/root', access: rootWrites.has(tool.name) ? 'write' : 'read' }));
const routes = scanRoutes(join(root, 'src/app/api'));

describe('reviewed customer UI/REST/MCP declaration parity', () => {
  it('requires an exact bidirectional mapping or reasoned route exception', () => {
    expect(parityErrors([...tools, ...privateTools], routes, [...mappings, ...rootMappings], aliases, exceptions)).toEqual([]);
  });
  it('maps private Root tools explicitly without treating installation authority as a customer feature', () => {
    expect(rootMappings.every(mapping => mapping.feature === 'installation/root')).toBe(true);
    expect(mappings.some(mapping => mapping.feature === 'installation/root')).toBe(false);
    expect(exceptions.some(exception => exception.id.includes('/api/root/'))).toBe(false);
    for (const name of rootWrites) expect(privateTools.some(tool => tool.name === name), name).toBe(true);
    for (const resource of rootResources) {
      const name = rootResourceTool(resource.uri);
      // This aggregate resource reuses the mapped provider evidence read without a provider filter.
      const mapped = name === 'get_root_platform_publication_evidence_resource' ? 'get_root_platform_publication_evidence' : name;
      expect(rootMappings.some(mapping => mapping.name === mapped), resource.uri).toBe(true);
    }
  });
  it('covers every manifest feature and rejects stale feature aliases', () => {
    const features = moduleManifests.flatMap(module => module.pages.map(page => page.id as string));
    expect(duplicateErrors(features, 'feature')).toEqual([]);
    expect(duplicateErrors(featureAliases.map(alias => alias.feature), 'feature alias')).toEqual([]);
    for (const tool of tools) expect(features, `Unknown feature on ${tool.name}`).toContain(tool.feature);
    for (const alias of featureAliases) {
      expect(features, `Stale alias ${alias.feature}`).toContain(alias.feature);
      expect(tools.some(tool => tool.feature === alias.feature), `Redundant alias ${alias.feature}`).toBe(false);
      expect(features).toContain(alias.target);
      expect(tools.some(tool => tool.feature === alias.target), `Uncovered target ${alias.target}`).toBe(true);
      expect(alias.reason.trim()).not.toBe('');
    }
    for (const feature of features) expect(tools.some(tool => tool.feature === feature) || featureAliases.some(alias => alias.feature === feature), `Unmapped manifest feature: ${feature}`).toBe(true);
  });
  it('keeps MCP resource reads inside the same mapped capability inventory', () => {
    for (const group of groups) for (const resource of group.resources ?? []) {
      expect(group.tools.some(tool => tool.name === resource.readTool), resource.uri).toBe(true);
      expect(mappings.some(mapping => mapping.name === resource.readTool), resource.uri).toBe(true);
    }
  });
});

describe('guard regression checks', () => {
  const tool: Tool = { name: 'read_example', feature: 'example/read', access: 'read' };
  const route = 'GET /api/example';
  const mapping: Mapping = { ...tool, routes: [route], reason: 'Same example read service.' };
  it('detects a new tool even when an existing route could dispatch it', () => {
    expect(parityErrors([tool, { ...tool, name: 'new_read' }], [route], [mapping], [], [])).toContain('Unmapped MCP tool: new_read');
  });
  it('detects a new route or method, including inside an excepted route family', () => {
    const extra = ['POST /api/example', 'GET /api/root/new-read'];
    expect(parityErrors([tool], [route, ...extra], [mapping], [], [])).toEqual(extra.map(value => `Unmapped REST route: ${value}`));
  });
  it('detects removal of either counterpart and feature/write reclassification', () => {
    expect(parityErrors([tool], [], [mapping], [], [])).toContain(`Missing REST counterpart: read_example -> ${route}`);
    expect(parityErrors([], [route], [mapping], [], [])).toContain('Stale tool mapping: read_example');
    expect(parityErrors([{ ...tool, access: 'write' }], [route], [mapping], [], [])).toContain('Changed feature/access: read_example');
  });
  it('rejects stale, unexplained and overlapping exceptions', () => {
    expect(parityErrors([tool], [route], [mapping], [], [{ id: route, reason: '' }, { id: 'GET /api/removed', reason: 'Removed.' }])).toEqual([
      `Exception requires a reason: ${route}`, `Mapped route also excepted: ${route}`, 'Stale REST exception: GET /api/removed',
    ]);
  });
  it('rejects aliases to absent MCP tools', () => {
    expect(parityErrors([], [route], [], [{ route, tools: ['missing'], reason: 'Example alias.' }], [])).toContain(`Missing MCP counterpart: ${route} -> missing`);
  });
  it('parses exported functions, aliases and named re-exports without false positives', () => {
    expect(exportedMethods(`
      // export function DELETE() {}
      const example = 'export const OPTIONS = fake';
      export async function GET() {}
      export const PATCH = handler, PUT = handler;
      export { read as HEAD, POST } from './http';
      export type { DELETE } from './types';
      function OPTIONS() {}
    `)).toEqual(['GET', 'HEAD', 'PATCH', 'POST', 'PUT']);
    expect(() => exportedMethods("export * from './http'")).toThrow('Export-star');
  });
  it('refuses missing or malformed documentation tables', () => {
    expect(() => table('', 'tools', 5)).toThrow('Missing/duplicate');
    expect(() => table('<!-- parity-tools:start -->\n| a | b |\n| --- | --- |\n| a | |\n<!-- parity-tools:end -->', 'tools', 2)).toThrow('Malformed');
  });
});


describe('Root workspace MCP uses the existing confirmed, audited services', () => {
  const actor = { userId: 'root', isInstanceOwner: true };
  const create = { name: ' Example Studio ', ownerEmail: 'Owner@Example.com', confirmation: 'CREATE Example Studio FOR owner@example.com' };
  const rename = { workspaceId: 'workspace-1', name: 'New Studio', confirmation: 'RENAME Example Studio TO New Studio' };
  beforeEach(() => {
    vi.clearAllMocks();
    state.actor.mockResolvedValue({ isInstanceOwner: true, disabledAt: null });
    state.currentRoot.mockResolvedValue({ id: 'root', isInstanceOwner: true });
    state.directory.mockResolvedValue({ total: 0, workspaces: [] });
    state.owner.mockResolvedValue({ id: 'owner', disabledAt: null });
    state.create.mockResolvedValue({ id: 'workspace-new', slug: 'example' });
    state.workspace.mockResolvedValue({ id: 'workspace-1', name: 'Example Studio', dataPurge: null });
    state.rename.mockResolvedValue({ count: 1 });
    state.audit.mockResolvedValue(1);
  });
  it('exposes the private workspace directory through the same REST and MCP service', async () => {
    const query = { q: 'Studio', page: '2' };
    const response = await workspaceDirectory(new Request('https://example.test/api/root/workspaces?q=Studio&page=2'), undefined);
    expect(response.status).toBe(200);
    expect(state.directory).toHaveBeenLastCalledWith(query, 10);
    await runRootTool({ ...actor, maxResultItems: 10 }, 'list_root_workspaces', { q: 'Studio', page: 2 });
    expect(state.directory).toHaveBeenLastCalledWith(query, 10);
    expect(response.headers.get('cache-control')).toContain('no-store');
  });
  it('refuses anonymous/non-Root directory requests and malformed or repeated filters', async () => {
    const request = (query = '') => new Request(`https://example.test/api/root/workspaces${query}`);
    state.currentRoot.mockResolvedValueOnce(null);
    expect((await workspaceDirectory(request(), undefined)).status).toBe(401);
    state.currentRoot.mockResolvedValueOnce({ id: 'member', isInstanceOwner: false });
    expect((await workspaceDirectory(request(), undefined)).status).toBe(404);
    for (const query of ['?page=0', '?page=1.5', '?page=wrong', '?q=a&q=b', '?workspaceId=other']) {
      expect((await workspaceDirectory(request(query), undefined)).status).toBe(400);
    }
    expect(state.directory).not.toHaveBeenCalled();
  });
  it('creates the active owner membership with Root timezone and the domain audit', async () => {
    await expect(runRootTool(actor, 'create_root_workspace', create)).resolves.toEqual({ id: 'workspace-new', slug: 'example' });
    expect(state.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      name: 'Example Studio', timezone: 'Africa/Casablanca', memberships: { create: expect.objectContaining({ userId: 'owner', role: 'owner' }) },
    }) }));
    expect(state.audit).toHaveBeenCalledOnce();
    expect(state.audit.mock.calls[0][3]).toBe('root.workspace_created');
  });
  it('passes an explicit timezone and renames with the shared optimistic check and audit', async () => {
    await runRootTool(actor, 'create_root_workspace', { ...create, timezone: 'UTC' });
    expect(state.create.mock.calls[0][0].data.timezone).toBe('UTC');
    state.audit.mockClear();
    await expect(runRootTool(actor, 'rename_root_workspace', rename)).resolves.toEqual({ changed: true });
    expect(state.rename).toHaveBeenCalledWith({ where: { id: 'workspace-1', name: 'Example Studio' }, data: { name: 'New Studio' } });
    expect(state.audit).toHaveBeenCalledOnce();
    expect(state.audit.mock.calls[0][3]).toBe('root.workspace_renamed');
  });
  it.each(['create_root_workspace', 'rename_root_workspace'])('refuses wrong confirmation for %s without writes or audit', async name => {
    await expect(runRootTool(actor, name, { ...(name === 'create_root_workspace' ? create : rename), confirmation: 'yes' })).rejects.toThrow();
    expect(state.create).not.toHaveBeenCalled(); expect(state.rename).not.toHaveBeenCalled(); expect(state.audit).not.toHaveBeenCalled();
  });
  it.each(['create_root_workspace', 'rename_root_workspace'])('excludes workspace keys and rechecks current Root identity for %s', async name => {
    const args = name === 'create_root_workspace' ? create : rename;
    await expect(runRootTool({ ...actor, apiKeyId: 'key' }, name, args)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(runRootTool({ ...actor, isInstanceOwner: false }, name, args)).rejects.toMatchObject({ code: 'forbidden' });
    state.actor.mockResolvedValueOnce({ isInstanceOwner: false, disabledAt: null });
    await expect(runRootTool(actor, name, args)).rejects.toMatchObject({ code: 'forbidden' });
    state.actor.mockResolvedValueOnce({ isInstanceOwner: true, disabledAt: new Date() });
    await expect(runRootTool(actor, name, args)).rejects.toMatchObject({ code: 'forbidden' });
    expect(state.create).not.toHaveBeenCalled(); expect(state.rename).not.toHaveBeenCalled(); expect(state.audit).not.toHaveBeenCalled();
  });
  it('enforces current name limits and rejects unexpected fields before mutation', async () => {
    await expect(runRootTool(actor, 'create_root_workspace', { ...create, name: 'x'.repeat(81) })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(runRootTool(actor, 'rename_root_workspace', { ...rename, name: 'x'.repeat(81) })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(runRootTool(actor, 'rename_root_workspace', { ...rename, workspaceId: 'x'.repeat(201) })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(runRootTool(actor, 'create_root_workspace', { ...create, isInstanceOwner: true })).rejects.toMatchObject({ code: 'invalid_request' });
    expect(state.create).not.toHaveBeenCalled(); expect(state.rename).not.toHaveBeenCalled();
  });
  it('retains service refusal for inactive owners, purge holds, stale names and audit failures', async () => {
    state.owner.mockResolvedValueOnce({ id: 'owner', disabledAt: new Date() });
    await expect(runRootTool(actor, 'create_root_workspace', create)).rejects.toThrow();
    expect(state.create).not.toHaveBeenCalled();
    state.workspace.mockResolvedValueOnce({ id: 'workspace-1', name: 'Example Studio', dataPurge: { status: 'requested' } });
    await expect(runRootTool(actor, 'rename_root_workspace', rename)).rejects.toThrow();
    expect(state.rename).not.toHaveBeenCalled();
    state.rename.mockResolvedValueOnce({ count: 0 });
    await expect(runRootTool(actor, 'rename_root_workspace', rename)).rejects.toThrow();
    expect(state.audit).not.toHaveBeenCalled();
    state.audit.mockRejectedValueOnce(new Error('private database detail'));
    await expect(runRootTool(actor, 'create_root_workspace', create)).rejects.toMatchObject({ code: 'upstream_failure' });
  });
});
