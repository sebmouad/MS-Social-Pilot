import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Optional file-only render for visual inspection. Never starts a server or reads customer data. */
export function writeB7Fixture(name: string, markup: string, module: 'home' | 'tasks' | 'agency', classes: Record<string, string>) {
  const directory = process.env.B7_FIXTURE_DIR;
  if (!directory) return;
  const shared = ['tokens.css', 'components.css', 'responsive.css'].map(file => readFileSync(join(process.cwd(), 'src/styles', file), 'utf8')).join('\n');
  const local = readFileSync(join(process.cwd(), `src/modules/${module}/ui/${module}.module.css`), 'utf8')
    .replace(/\.([a-zA-Z_][\w-]*)/g, (selector, key: string) => classes[key] ? `.${classes[key]}` : selector);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, `${name}.html`), `<!doctype html><html lang="en" data-theme="clean" data-mode="light"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${name} · synthetic component fixture</title><style>${shared}\n${local}\nbody{margin:0;background:var(--canvas);color:var(--ink);font-family:Inter,system-ui,sans-serif}main{max-width:var(--content-max);padding:var(--gutter);margin:auto;min-width:0}</style><main>${markup}</main></html>`);
}
