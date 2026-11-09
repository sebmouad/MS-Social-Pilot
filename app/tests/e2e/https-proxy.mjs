// Local end-to-end runs: serve the app over HTTPS like production, so Facebook's HTTPS-only callback matches.
//   node tests/e2e/https-proxy.mjs <listen port> <app port> <cert.pem> <key.pem>
import https from 'node:https';
import http from 'node:http';
import { readFileSync } from 'node:fs';
const [listen, target, cert, key] = process.argv.slice(2);
https.createServer({ cert: readFileSync(cert), key: readFileSync(key) }, (req, res) => {
  const upstream = http.request({ host: '127.0.0.1', port: Number(target), method: req.method, path: req.url, headers: { ...req.headers, 'x-forwarded-proto': 'https', 'x-forwarded-host': req.headers.host } }, reply => {
    res.writeHead(reply.statusCode ?? 502, reply.headers); reply.pipe(res);
  });
  upstream.on('error', () => { res.writeHead(502); res.end(); });
  req.pipe(upstream);
}).listen(Number(listen), () => console.log(`https://localhost:${listen} -> http://127.0.0.1:${target}`));
