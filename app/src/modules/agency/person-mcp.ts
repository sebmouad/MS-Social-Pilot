import { operationFailure } from '@/lib/operation-error';
import { copyError, copyText, withCustomerCopy } from './server/copy';
import { assertPersonCredential } from '@/modules/settings/person-keys/service';
import type { PersonMcpIdentity } from '@/modules/settings/person-keys/types';
import { agencyToolDefinitions, executeAgencyTool } from './mcp';

/** Fixed read ceiling, kept out of the workspace and installation catalogs. */
export const agencyPersonTools = agencyToolDefinitions.filter(tool => tool.name === 'get_agency_overview');
const resource = { uri: 'msp://agency/overview', name: 'Agency overview', description: 'Current authorized cross-workspace overview.', mimeType: 'application/json' };
const textResult = (value: unknown) => ({ content: [{ type: 'text', text: JSON.stringify(value, null, 2) }], structuredContent: value });

/** The host validates the JSON-RPC envelope before choosing this disjoint person dispatcher. */
async function handleAgencyPersonMessageImpl(viewer: PersonMcpIdentity, message: Record<string, unknown>) {
  const id = message.id ?? null;
  const params = (message.params ?? {}) as Record<string, unknown>;
  const reply = (result: unknown) => Response.json({ jsonrpc: '2.0', id, result }, { headers: { 'cache-control': 'no-store' } });
  const error = (code: number, message: string) => Response.json({ jsonrpc: '2.0', id, error: { code, message } }, { headers: { 'cache-control': 'no-store' } });
  try { await assertPersonCredential(viewer); }
  catch (failure) { const safe = operationFailure(failure, copyText('Person MCP access could not be checked.')); return error(-32001, safe.error); }
  if (message.method === 'ping') return reply({});
  if (message.method === 'initialize') {
    const versions = ['2025-06-18', '2025-03-26', '2024-11-05'];
    const requested = String(params.protocolVersion ?? '');
    return reply({ protocolVersion: versions.includes(requested) ? requested : versions[0], capabilities: { tools: { listChanged: false }, resources: { subscribe: false, listChanged: false } }, serverInfo: { name: 'ms-social-pilot', version: '0.1.0' }, instructions: 'Read-only person Agency overview access. Each read checks current roles, membership, permissions and entitlements separately in every workspace. No workspace writes, client directory or Root access.' });
  }
  if (message.method === 'tools/list') return reply({ tools: agencyPersonTools });
  if (message.method === 'resources/list') return reply({ resources: [resource] });
  if (message.method === 'tools/call' || message.method === 'resources/read') {
    try {
      const isResource = message.method === 'resources/read';
      if (isResource ? params.uri !== resource.uri : params.name !== 'get_agency_overview') throw copyError('forbidden', 'This credential permits only the Agency overview.');
      if (!isResource && params.arguments !== undefined && (!params.arguments || typeof params.arguments !== 'object' || Array.isArray(params.arguments))) throw copyError('invalid_request', 'Tool arguments must be an object.');
      const args = isResource ? {} : (params.arguments ?? {}) as Record<string, unknown>;
      // The existing person service owns all per-workspace authorization and data scope.
      const result = await executeAgencyTool({ scope: 'person', userId: viewer.userId }, 'get_agency_overview', args);
      return isResource ? reply({ contents: [{ uri: resource.uri, mimeType: resource.mimeType, text: JSON.stringify(result, null, 2) }] }) : reply(textResult(result));
    } catch (failure) {
      const safe = operationFailure(failure, copyText('The Agency overview could not be read.'));
      return message.method === 'resources/read' ? error(-32602, safe.error) : reply({ ...textResult({ error: safe.error, code: safe.code }), isError: true });
    }
  }
  return error(-32601, copyText('Method not found.'));
}

export const handleAgencyPersonMessage = (...args: Parameters<typeof handleAgencyPersonMessageImpl>) => withCustomerCopy(() => handleAgencyPersonMessageImpl(...args));
