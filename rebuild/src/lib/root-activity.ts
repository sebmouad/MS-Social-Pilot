import { OperationError } from './operation-error';

export type RootActivityInput = { q?: string; workspaceId?: string; from?: string; to?: string; limit?: number; cursor?: string };
export type RootActivitySearch = Record<string, string | string[] | undefined>;
const fields = new Set(['q', 'workspaceId', 'from', 'to', 'limit', 'cursor']);

/** URL transport decoding only. Domain validation is shared by UI/API/MCP. */
export function rootActivitySearchParams(params: RootActivitySearch): RootActivityInput {
  const input: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    if (!fields.has(key) || Array.isArray(value)) throw new OperationError('invalid_request', 'Choose valid activity filters.');
    if (value === undefined || value === '') continue;
    if (key === 'limit') {
      if (!/^[1-9]\d*$/.test(value)) throw new OperationError('invalid_request', 'Choose a valid activity page size.');
      input.limit = Number(value);
    } else input[key] = value;
  }
  return input as RootActivityInput;
}

export function rootActivityUrl(input: RootActivityInput, cursor?: string | null) {
  const params = new URLSearchParams();
  for (const key of ['q', 'workspaceId', 'from', 'to', 'limit'] as const) {
    if (input[key] !== undefined && input[key] !== '') params.set(key, String(input[key]));
  }
  if (cursor) params.set('cursor', cursor);
  return `/root/activity${params.size ? `?${params}` : ''}`;
}
