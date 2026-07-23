/* Finish the standalone build so it can actually serve.
 *
 * `next build` with output:'standalone' emits a server.js and its traced
 * node_modules, but deliberately leaves out the static assets — the Dockerfile
 * copies them in by hand (see Dockerfile: COPY .next/static, COPY public). The
 * desktop build needs the same two copies, so this runs as part of
 * `yarn build:desktop`.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const standalone = path.join(root, '.next', 'standalone');

if (!fs.existsSync(path.join(standalone, 'server.js'))) {
  console.error('No standalone build found — run `yarn build` first.');
  process.exit(1);
}

for (const [from, to] of [
  [path.join(root, '.next', 'static'), path.join(standalone, '.next', 'static')],
  [path.join(root, 'public'), path.join(standalone, 'public')],
]) {
  fs.cpSync(from, to, { recursive: true });
  console.log(`copied ${path.relative(root, from)} → ${path.relative(root, to)}`);
}

/* Next's file tracing sweeps in our own build tooling — most damagingly the
 * `electron` package, which carries a complete Electron.app (~296 MB). Nesting
 * that inside the packaged Electron.app doubles the bundle AND breaks signing:
 * codesign rejects the framework symlinks with "invalid destination for
 * symbolic link in bundle". None of it is used at runtime; the server only
 * needs Next and its own deps.
 */
const buildOnly = ['electron', '@electron', '@electron-internal', 'electron-builder'];
for (const name of buildOnly) {
  const dir = path.join(standalone, 'node_modules', name);
  if (!fs.existsSync(dir)) continue;
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`pruned node_modules/${name}`);
}

console.log('standalone build ready');
