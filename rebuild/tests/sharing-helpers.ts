import { vi } from 'vitest';
import { SHARING_CONFIG } from '../src/modules/sharing/config';

export const state = ({
  queries: [] as Array<{ sql: string; values: unknown[] }>, executions: [] as Array<{ sql: string; values: unknown[] }>,
  role: 'owner', disabled: false, suspended: false, purging: false, entitled: true, moduleOn: true,
  /** features the plan includes / the role may read or write; others are denied. */
  planDenied: [] as string[], readDenied: [] as string[], writeDenied: [] as string[],
  canApprove: true, scope: { all: true } as { all: true } | { all: false; ids: string[] },
  respond: (_sql: string, _values: unknown[]): unknown => undefined as unknown, failAudit: false, transactions: 0,
});
export const db = { $queryRaw: vi.fn(), $executeRaw: vi.fn(), $transaction: vi.fn(), user: { findUnique: vi.fn() }, membership: { findUnique: vi.fn() } };
export const defaults = Object.fromEntries(SHARING_CONFIG.map(item => [item.key, item.defaultValue]));
export function sql(strings: TemplateStringsArray, values: unknown[]) { return { sql: strings.join('?'), values }; }

/** Shared module mocks, installed with vi.mock in each test file so the services run against the fake database. */
export const entitlementMock = () => ({
  loadEntitlements: async (_u: string, workspaceId: string) => (state.entitled ? { workspaceId } : null),
  canUseModule: () => state.moduleOn,
  canUseFeature: (_e: unknown, feature: string) => !state.planDenied.includes(feature),
});
export const permissionMock = () => ({
  /** A key ceiling is modelled as `{ denied: ['feature:mode'] }`; a member's grants as everything not listed in state. */
  canAccessFeature: (p: unknown, feature: string, access: string) => {
    if ((p as { denied?: string[] } | null)?.denied?.includes(`${feature}:${access}`)) return false;
    return !(access === 'read' ? state.readDenied : [...state.readDenied, ...state.writeDenied]).includes(feature) && (feature !== 'publishing/approvals' || access !== 'write' || state.canApprove);
  },
  resolvePermissions: () => ({ features: {}, pageScope: state.scope }),
});

export function install() {
  vi.clearAllMocks(); state.queries = []; state.executions = []; state.role = 'owner'; state.disabled = false; state.suspended = false; state.purging = false; state.entitled = true; state.moduleOn = true;
  state.planDenied = []; state.readDenied = []; state.writeDenied = []; state.canApprove = true; state.scope = { all: true }; state.respond = () => undefined; state.failAudit = false; state.transactions = 0;
  db.$transaction.mockImplementation(async (cb: (tx: typeof db) => Promise<unknown>) => { state.transactions += 1; return cb(db); });
  db.$queryRaw.mockImplementation(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const q = sql(strings, values); state.queries.push(q);
    const custom = state.respond(q.sql, q.values); if (custom !== undefined) return custom;
    if (q.sql.includes('SELECT m."userId" FROM memberships m')) return state.role === 'owner' && !state.disabled ? [{ userId: 'owner-1' }] : [];
    if (q.sql.includes('FROM memberships m JOIN users u')) return state.role === 'none' || state.disabled ? [] : [{ role: state.role, suspendedAt: state.suspended ? new Date() : null, allPages: true, memberDisabled: [], workspaceDisabled: [], clientAccess: [] }];
    if (q.sql.includes('FROM workspaces WHERE id')) return [{ id: 'workspace-a' }];
    if (q.sql.startsWith('SELECT status::text FROM workspace_data_purges')) return state.purging ? [{ status: 'running' }] : [];
    return [];
  });
  db.$executeRaw.mockImplementation(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const q = sql(strings, values); state.executions.push(q);
    if (state.failAudit && q.sql.includes('activity_logs')) throw new Error('audit write failed');
    return 1;
  });
}
