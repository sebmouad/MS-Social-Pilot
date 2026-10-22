import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

/** Lane-owned tests while the integrator owns rebuild/tests and the main config. */
export default defineConfig({
  root: fileURLToPath(new URL('../../../../', import.meta.url)),
  esbuild: { jsx: 'automatic' },
  test: { environment: 'node', include: ['src/modules/notifications/chat-channels/tests/**/*.test.ts'] },
  resolve: { alias: { '@': fileURLToPath(new URL('../../../', import.meta.url)) } },
});
