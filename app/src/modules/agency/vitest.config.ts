import base from '../../../vitest.config';

// Keep Agency-owned tests runnable without changing the shared test host.
export default {
  ...base,
  test: { ...base.test, include: ['tests/agency-*.test.ts', 'tests/raw-sql-void-guard.test.ts', 'src/modules/agency/**/*.test.ts'] },
};
