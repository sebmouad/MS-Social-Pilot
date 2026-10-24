import { OperationError, isOperationErrorCode, operationFailure } from '@/lib/operation-error';
import { handleMcpMessage } from '@/server/mcp/server';
import type { McpToolGroup } from '@/server/mcp/kit';
import { handleKey, query } from '../http';
import { readCappedJson } from './rest';

/** REST transport only. The MCP host remains the single dispatch boundary for key
 * policy, current permissions, locks, availability, confirmations and receipts.
 * Groups supplied by the owning module are an allowlist, never a caller input.
 */
export function keyToolEndpoint(groups: readonly McpToolGroup[]) {
  return async (request: Request, context: { params: Promise<{ operation: string }> }) => {
    const { operation } = await context.params;
    const group = groups.find(candidate => candidate.tools.some(tool => tool.name === operation));
    let operationFailureResponse: Response | undefined;
    const response = await handleKey(request, {
      ...(group ? { need: { feature: group.features[operation]!, write: [...(group.writeTools ?? [])].includes(operation) } } : {}),
      fallback: 'The request could not be completed. Check the current state before trying again.',
      run: async ctx => {
        if (!group) throw new OperationError('not_found', 'Unknown operation.');
        const write = [...(group.writeTools ?? [])].includes(operation);
        if (request.method === 'GET' && write) throw new OperationError('invalid_request', 'Use POST for this operation.');
        let input: unknown;
        if (request.method === 'GET') {
          // JSON preserves arrays, booleans and numeric pagination without a
          // second, subtly different query schema. Reuse the Root request cap.
          const value = query(request, ['input']).input ?? '{}';
          input = await readCappedJson(new Request(request.url, { method: 'POST', body: value }));
        } else {
          query(request, []);
          input = await readCappedJson(request);
        }
        if (!input || typeof input !== 'object' || Array.isArray(input)) throw new OperationError('invalid_request', 'Send a JSON object.');
        const response = await handleMcpMessage(ctx.viewer, { jsonrpc: '2.0', id: operation, method: 'tools/call', params: { name: operation, arguments: input } });
        const envelope = await response.json();
        if (envelope.error) throw new OperationError(isOperationErrorCode(envelope.error.data?.code) ? envelope.error.data.code : 'invalid_request', envelope.error.message);
        const result = envelope.result;
        if (result.isError) {
          const failure = result.structuredContent;
          const safe = operationFailure(new OperationError(isOperationErrorCode(failure.code) ? failure.code : 'upstream_failure', failure.error), 'The request could not be completed.');
          // Preserve safe Ads attempt metadata: a failed response must never
          // encourage repeating an uncertain remote mutation with a new id.
          operationFailureResponse = Response.json(failure, { status: safe.status, headers: { 'cache-control': 'no-store' } });
          return null;
        }
        return result.structuredContent;
      },
    });
    return operationFailureResponse ?? response;
  };
}
