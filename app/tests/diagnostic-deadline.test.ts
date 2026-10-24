import { describe, expect, it } from 'vitest';
import { diagnosticRecoverySeconds, withinDiagnosticDeadline } from '../src/server/diagnostics/deadline';
describe('diagnostic suite deadline', () => {
  it('stops waiting when cancellation arrives and never starts an already-cancelled check', async () => {
    const controller = new AbortController();
    const waiting = withinDiagnosticDeadline(() => new Promise<string>(() => {}), controller.signal);
    const expected = expect(waiting).rejects.toBe('deadline');
    controller.abort('deadline'); await expected;
    let called = false;
    expect(() => withinDiagnosticDeadline(async () => { called = true; return ''; }, controller.signal)).toThrow();
    expect(called).toBe(false);
  });
  it('returns completed checks and preserves original recovery floor above total deadline and audit grace', async () => {
    expect(await withinDiagnosticDeadline(async () => 'done', new AbortController().signal)).toBe('done');
    expect(diagnosticRecoverySeconds(10, 60000, 5000)).toBe(70);
    expect(diagnosticRecoverySeconds(600, 60000, 5000)).toBe(600);
  });
});
