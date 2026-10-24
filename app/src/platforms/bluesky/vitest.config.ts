import { fileURLToPath } from 'node:url';
/** Provider-local tests live in owned paths; the application suite includes tests/ only. */
export default {
  root: fileURLToPath(new URL('../../../', import.meta.url)),
  resolve: { alias: { '@': fileURLToPath(new URL('../../', import.meta.url)) } },
  test: { environment: 'node', include: ['src/platforms/bluesky/client.test.ts', 'src/platforms/telegram/client.test.ts'] },
};
