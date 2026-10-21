#!/usr/bin/env node
/* Source-level UI / API / MCP reachability of module service functions. Usage (from rebuild/src): node ../scripts/parity-inventory.mjs . [module]
 * Output: per-module counts by entry-point combination; with [module], one line per function. A lead list, not proof: confirm each item in code. */
import fs from 'fs'; import path from 'path';
const root = process.argv[2];
const files = [];
(function walk(d){ for (const e of fs.readdirSync(d,{withFileTypes:true})) { const p=path.join(d,e.name); if (e.isDirectory()) { if(!/node_modules/.test(p)) walk(p);} else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\./.test(e.name)) files.push(p);} })(root);
const rel = f => path.relative(root,f);
function kind(f){ const r=rel(f);
  if (/mcp[^/]*\.ts$/.test(r) || /\/mcp\//.test(r)) return 'MCP';
  if (/^app\/api\//.test(r) || /\/rest\.ts$|\/http\.ts$|-http\.ts$/.test(r)) return 'API';
  if (/^app\/.*(page|layout|actions?)\.tsx?$/.test(r) || /\/ui\//.test(r) || /\.tsx$/.test(r) || /actions?\.ts$/.test(r)) return 'UI';
  return null; }
// service exports: modules/*/server/** and modules/*/*/server.ts etc.
const svc = new Map(); // name -> {file, users:Set}
for (const f of files) { const r=rel(f); if (!/^modules\/[^/]+\/(.*\/)?server(\/|\.ts$)/.test(r) || /\/mcp|rest\.ts|http\.ts/.test(r)) continue;
  const src=fs.readFileSync(f,'utf8');
  for (const m of src.matchAll(/export\s+(?:async\s+)?function\s+([A-Za-z0-9_]+)/g)) svc.set(m[1],{file:r,mod:r.split('/')[1],k:new Set()});
  for (const m of src.matchAll(/export\s+const\s+([A-Za-z0-9_]+)\s*=\s*(?:async\s*)?\(/g)) svc.set(m[1],{file:r,mod:r.split('/')[1],k:new Set()}); }
for (const f of files) { const k=kind(f); if(!k) continue; const src=fs.readFileSync(f,'utf8');
  const imported = new Set(); for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from/g)) for (const n of m[1].split(',')) { const nm=n.trim().split(/\s+as\s+/)[0].replace(/^type\s+/,''); if(nm) imported.add(nm); }
  for (const n of imported) if (svc.has(n)) svc.get(n).k.add(k); }
// UI reachability through fetched API routes
const routeOf = f => '/'+rel(f).replace(/^app\//,'').replace(/\/route\.ts$/,'').replace(/\[[^\]]+\]/g,'*');
const routeSvc = new Map();
for (const f of files) { if(!/^app\/api\/.*route\.ts$/.test(rel(f))) continue; const src=fs.readFileSync(f,'utf8'); const names=new Set(); for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from/g)) for (const n of m[1].split(',')) names.add(n.trim().split(/\s+as\s+/)[0].replace(/^type\s+/,'')); routeSvc.set(routeOf(f), names); }
const fetched = new Set();
for (const f of files) { if (kind(f)!=='UI') continue; const src=fs.readFileSync(f,'utf8'); for (const m of src.matchAll(/[`'"](\/api\/[^`'"?\s]*)/g)) fetched.add(m[1].replace(/\$\{[^}]*\}/g,'*').replace(/\/$/,'')); }
const match = (route) => [...fetched].some(u => { const a=u.split('/'), b=route.split('/'); if (a.length!==b.length) return false; return a.every((x,i)=>x===b[i]||b[i]==='*'||x==='*'||x.includes('*')); });
for (const [route,names] of routeSvc) if (match(route)) for (const n of names) if (svc.has(n)) svc.get(n).k.add('UI');
// internal: imported by other server files
for (const f of files) { if (kind(f)) continue; const src=fs.readFileSync(f,'utf8'); for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from/g)) for (const n of m[1].split(',')) { const nm=n.trim().split(/\s+as\s+/)[0].replace(/^type\s+/,''); if (svc.has(nm) && svc.get(nm).file!==rel(f)) svc.get(nm).internal=true; } }
const byMod = {};
for (const [n,v] of svc) { const key=[...v.k].sort().join('+')||(v.internal?'internal':'unused'); (byMod[v.mod] ??= {})[key] = ((byMod[v.mod]??{})[key]||0)+1; }
console.log(JSON.stringify(byMod,null,0));
const want = process.argv[3];
if (want) for (const [n,v] of svc) if (v.mod===want) console.log([...v.k].sort().join('+')||(v.internal?'internal':'unused'), n, v.file);
