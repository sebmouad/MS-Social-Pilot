import { describe, expect, it } from 'vitest';
import { ROOT_DIAGNOSTICS_COPY, diagnosticsCopyText } from '../src/lib/config/root-diagnostics-copy';
import { ROOT_JOBS_COPY, jobsCopyText } from '../src/lib/config/root-jobs-copy';

describe('Root diagnostics and jobs copy catalogs', () => {
  it('provides nonempty defaults for operator status and feedback', () => {
    expect(Object.values(ROOT_DIAGNOSTICS_COPY).every(value => typeof value === 'string' && value.length > 0)).toBe(true);
    expect(Object.values(ROOT_JOBS_COPY).every(value => typeof value === 'string' && value.length > 0)).toBe(true);
  });

  it('interpolates named values while retaining unknown placeholders', () => {
    expect(diagnosticsCopyText(ROOT_DIAGNOSTICS_COPY.checksFinished, { passed: 2, failed: 1, skipped: 3 })).toBe('Checks finished: 2 passed, 1 failed, 3 skipped.');
    expect(jobsCopyText('{job}: {state}', { job: 'Queue' })).toBe('Queue: {state}');
  });
});
