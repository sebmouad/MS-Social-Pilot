import { defineConfig } from 'vitest/config';
import base from '../../../../vitest.config';
export default defineConfig({ ...base, test: { environment: 'node', include: ['src/modules/analytics/ad-objects/*.test.{ts,tsx}'] } });
