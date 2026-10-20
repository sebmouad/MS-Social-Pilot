import { mergeConfig } from 'vitest/config';
import base from '../../../../vitest.config';

// Keep the regression fixtures inside this module's ownership boundary.
export default mergeConfig(base, { test: { include: ['tests/**/*.test.ts', 'src/modules/ads/**/*.test.ts'] } });
