import { OperationError } from '@/lib/operation-error';
import { INSTALLED_POST_ORIGIN_SOURCES } from '@/modules/installed-post-origins';

/**
 * Where a post came from when it was not written in the composer, as a query-side port. Publishing knows only this
 * neutral shape; an installed feature answers it from its own records and is listed in `installed-post-origins`.
 */
export interface PostOriginSource {
  /** Stable identifier used in the `origin` filter parameter. */
  kind: string;
  /** Ids of this workspace's posts with this origin. The caller still applies its own authorization scope. */
  matchingPostIds(workspaceId: string): Promise<string[]>;
}

/** The requested origin when it names an installed source; anything else is a refused filter, never ignored. */
export function parsePostOrigin(value: unknown, sources: readonly PostOriginSource[] = INSTALLED_POST_ORIGIN_SOURCES): string | undefined {
  if (value === undefined || value === '') return undefined;
  if (typeof value !== 'string' || !sources.some(source => source.kind === value)) throw new OperationError('invalid_request', 'Choose a valid post origin.');
  return value;
}

/** Post-list condition for the origin, evaluated in the same query as every other filter so totals and pages are exact. */
export async function postOriginWhere(workspaceId: string, kind: string, sources: readonly PostOriginSource[] = INSTALLED_POST_ORIGIN_SOURCES): Promise<{ id: { in: string[] } }> {
  const source = sources.find(candidate => candidate.kind === kind);
  if (!source) throw new OperationError('invalid_request', 'Choose a valid post origin.');
  return { id: { in: await source.matchingPostIds(workspaceId) } };
}
