#!/usr/bin/env node
/**
 * Start the web app on the configured port and interface.
 *
 * A wrapper rather than plain `next start` for two reasons. `next start` reads
 * the port from `PORT` and the interface from `HOSTNAME`, and `HOSTNAME` is
 * also what Docker sets to the container id — so a containerised app would try
 * to bind to a hostname that is not an interface. And the CLI flags are parsed
 * by the shell before Next loads `.env`, so a port set there would never reach
 * them. This reads `.env` first, then passes both as explicit arguments.
 */

import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');

/**
 * The handful of keys this script needs, read straight from `.env`.
 *
 * Deliberately not a general parser: everything else in `.env` is read by Next
 * and by the app itself, which do it properly. Values already in the
 * environment win, because that is how a systemd unit or `docker run -e`
 * overrides a file.
 */
function fromEnvFile(name) {
  if (process.env[name]) return process.env[name];

  const file = resolve(root, '.env');
  if (!existsSync(file)) return undefined;

  const match = readFileSync(file, 'utf8').match(new RegExp(`^${name}=(.*)$`, 'm'));
  return match?.[1]?.trim().replace(/^["']|["']$/g, '') || undefined;
}

const port = fromEnvFile('PORT') ?? '80';
const host = fromEnvFile('HOST') ?? '0.0.0.0';

if (Number(port) < 1024) {
  // The default, not an unusual choice: HTTPS is terminated by Cloudflare or
  // another proxy, and this app serves plain HTTP on 80. Root and
  // CAP_NET_BIND_SERVICE both make it work — but the error Node gives when
  // neither is in place is a bare EACCES with nothing attached saying why.
  console.log(
    `Binding privileged port ${port}. If this fails with EACCES, either run as ` +
      `root or grant the capability once:\n` +
      `  sudo setcap 'cap_net_bind_service=+ep' "$(command -v node)"`,
  );
}

const next = resolve(root, 'node_modules/next/dist/bin/next');
const child = spawn(process.execPath, [next, 'start', '--port', port, '--hostname', host], {
  cwd: root,
  stdio: 'inherit',
});

// Pass signals through rather than dying and orphaning the server: systemd and
// Docker both stop this process, and the one doing the work is the child.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
