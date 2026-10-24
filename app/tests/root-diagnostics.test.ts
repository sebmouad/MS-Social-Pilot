import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ actor: vi.fn(), query: vi.fn(), execute: vi.fn(), transaction: vi.fn(), connection: vi.fn(), connections: vi.fn(), checks: vi.fn(), config: vi.fn() }));
vi.mock('../src/server/data', () => ({ prisma: { user: { findUnique: state.actor }, $queryRaw: state.query, $executeRaw: state.execute, $transaction: state.transaction, socialAccount: { findFirst: state.connection, findMany: state.connections } } }));
vi.mock('../src/server/config/store', () => ({ runtimeConfig: state.config }));
vi.mock('../src/server/diagnostics/checks', () => ({ diagnosticChecks: state.checks }));
import { listRootDiagnostics, runRootDiagnostics } from '../src/server/root/diagnostics';
const input = { scope: 'shared', confirmation: 'RUN DIAGNOSTICS shared' };
const sql = (strings: TemplateStringsArray) => strings.join('?');
beforeEach(() => {
  vi.clearAllMocks();
  state.actor.mockResolvedValue({ isInstanceOwner: true, disabledAt: null });
  state.config.mockImplementation(async key => ({ 'diagnostics.enabled': true, 'diagnostics.runTimeoutMs': 60000, 'root.operationalTimezone': 'UTC', 'diagnostics.historyLimit': 10, 'diagnostics.minimumIntervalSeconds': 30, 'diagnostics.incompleteRunStaleSeconds': 600, 'diagnostics.databaseTimeoutMs': 5000 }[key as string]));
  state.query.mockImplementation(async (strings: TemplateStringsArray) => sql(strings).includes('FROM users') ? [{ isInstanceOwner: true, disabledAt: null }] : sql(strings).includes('SELECT EXISTS') ? [{ present: false }] : []);
  state.execute.mockResolvedValue(1);
  state.transaction.mockImplementation(async run => run({ $queryRaw: state.query, $executeRaw: state.execute }));
  state.connections.mockResolvedValue([]); state.connection.mockResolvedValue({ id: 'connection' });
  state.checks.mockResolvedValue([{ id: 'database', label: 'Database', run: async () => ({ status: 'pass', code: 'read_ok', message: 'Read completed.' }) }]);
});
describe('private diagnostic service', () => {
  it.each([null, { isInstanceOwner: false }, { isInstanceOwner: true, disabledAt: new Date() }])('denies missing, demoted and disabled actors before any probes or history', async actor => {
    state.actor.mockResolvedValue(actor);
    await expect(runRootDiagnostics('root', input)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(listRootDiagnostics('root', 'shared')).rejects.toMatchObject({ code: 'forbidden' });
    expect(state.query).not.toHaveBeenCalled(); expect(state.checks).not.toHaveBeenCalled(); expect(state.execute).not.toHaveBeenCalled();
  });
  it.each([{ scope: 'shared', confirmation: 'yes' }, { scope: 'platform:uninstalled', confirmation: 'RUN DIAGNOSTICS platform:uninstalled' }, { ...input, url: 'https://arbitrary.test' }, { ...input, connectionId: 'wrong' }])('rejects invalid or unconfirmed scope before side effects', async invalid => {
    await expect(runRootDiagnostics('root', invalid)).rejects.toMatchObject({ code: 'invalid_request' });
    expect(state.transaction).not.toHaveBeenCalled(); expect(state.checks).not.toHaveBeenCalled();
  });
  it('honors enabled switch and refuses cross-provider connections', async () => {
    state.config.mockImplementation(async key => key === 'diagnostics.enabled' ? false : 10);
    await expect(runRootDiagnostics('root', input)).rejects.toMatchObject({ code: 'unavailable' });
    state.config.mockImplementation(async key => key === 'diagnostics.enabled' ? true : 5000);
    state.connection.mockResolvedValue(null);
    await expect(runRootDiagnostics('root', { scope: 'platform:facebook', connectionId: 'wrong-provider', confirmation: 'RUN DIAGNOSTICS platform:facebook' })).rejects.toMatchObject({ code: 'not_found' });
    expect(state.connection).toHaveBeenCalledWith({ where: { id: 'wrong-provider', provider: 'facebook' }, select: { id: true } });
    expect(state.transaction).not.toHaveBeenCalled();
  });
  it('serializes scope-wide starts, rechecks authority and refuses cooldown before probes', async () => {
    state.query.mockImplementation(async (strings: TemplateStringsArray) => sql(strings).includes('FROM users') ? [{ isInstanceOwner: true, disabledAt: null }] : [{ present: true }]);
    await expect(runRootDiagnostics('root', input)).rejects.toMatchObject({ code: 'conflict' });
    expect(state.query.mock.calls.map(call => sql(call[0])).join(' ')).toContain('pg_advisory_xact_lock');
    expect(state.checks).not.toHaveBeenCalled(); expect(state.execute).not.toHaveBeenCalled();
    state.query.mockImplementation(async (strings: TemplateStringsArray) => sql(strings).includes('FROM users') ? [{ isInstanceOwner: false, disabledAt: null }] : []);
    await expect(runRootDiagnostics('root', input)).rejects.toMatchObject({ code: 'forbidden' });
    expect(state.checks).not.toHaveBeenCalled();
  });
  it('requires start audit before executing, masks raw exceptions and continues other checks', async () => {
    state.execute.mockRejectedValueOnce(new Error('database password'));
    await expect(runRootDiagnostics('root', input)).rejects.toThrow('database password');
    expect(state.checks).not.toHaveBeenCalled();
    state.execute.mockResolvedValue(1);
    state.checks.mockResolvedValue([
      { id: 'transport', label: 'API', run: async () => { throw new Error('https://private/token=secret'); } },
      { id: 'next', label: 'Next', run: async () => ({ status: 'skipped', code: 'not_selected', message: 'Choose a source.' }) },
    ]);
    const result = await runRootDiagnostics('root', input);
    expect(result.checks.map(check => check.status)).toEqual(['fail', 'skipped']);
    expect(result.checks.every(check => check.durationMs >= 0)).toBe(true);
    expect(result.auditRecorded).toBe(true);
    expect(JSON.stringify(result)).not.toContain('token=secret');
    const persisted = JSON.parse(state.execute.mock.calls.at(-1)![3]);
    expect(persisted).toMatchObject({ id: result.id, scope: 'shared', checks: result.checks });
  });
  it('cancels slow probes at total deadline, skips remaining checks and records the timed-out receipt', async () => {
    const controller = new AbortController();
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
    let begin!: () => void;
    const began = new Promise<void>(resolve => { begin = resolve; });
    const next = vi.fn(async () => ({ status: 'pass', code: 'wrong', message: 'Should not run.' }));
    state.checks.mockResolvedValueOnce([
      { id: 'slow', label: 'Slow API', run: async (signal: AbortSignal) => { expect(signal).toBe(controller.signal); begin(); return new Promise(() => {}); } },
      { id: 'next', label: 'Next', run: next },
    ]);
    try {
      const pending = runRootDiagnostics('root', input); await began; controller.abort(new DOMException('Deadline', 'TimeoutError'));
      const result = await pending;
      expect(result.auditRecorded).toBe(true);
      expect(result.checks.map(check => check.code)).toEqual(['check_timed_out', 'deadline_exceeded']); expect(next).not.toHaveBeenCalled();
    } finally { timeout.mockRestore(); }
  });
  it('keeps the receipt and explicit warning when completion audit fails', async () => {
    state.execute.mockResolvedValueOnce(1).mockRejectedValueOnce(new Error('raw-audit-secret'));
    const result = await runRootDiagnostics('root', input);
    expect(result).toMatchObject({ auditRecorded: false, checks: [{ status: 'pass' }] });
    expect(result.warning).toContain('could not be recorded');
    expect(JSON.stringify(result)).not.toContain('raw-audit-secret');
  });
  it('records safe setup failures and bounds history/connections by MCP cap', async () => {
    state.checks.mockRejectedValueOnce(new Error('secret')); const result = await runRootDiagnostics('root', input);
    expect(result.checks[0]).toMatchObject({ status: 'fail', code: 'setup_failed' });
    const history = await listRootDiagnostics('root', 'platform:facebook', 2);
    expect(history.history).toEqual([]); expect(history.connectionLimit).toBe(2);
    expect(state.connections.mock.calls[0][0]).toMatchObject({ where: { provider: 'facebook' }, take: 2, select: { id: true, name: true, workspaceId: true } });
    await expect(listRootDiagnostics('root', 'shared', 0)).rejects.toMatchObject({ code: 'invalid_request' });
  });
});
