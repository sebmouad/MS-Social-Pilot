import { defineConfig } from 'vitest/config';
import base from '../../../vitest.config';
/** Tests stay within this lane's ownership. Integrator can add this glob to the root config. */
export default defineConfig({ ...base, cacheDir: 'src/modules/calendar-extras/.vite', test: { ...base.test, cache: false, include: ['src/modules/calendar-extras/tests/**/*.test.ts'] } });
