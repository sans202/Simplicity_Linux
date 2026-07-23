/* electron-builder afterPack hook — stage the server payload, then ad-hoc sign.
 *
 * Two jobs, in this order:
 *
 * 1. Copy the standalone server and migrations into the bundle's resources.
 *    This is done here rather than via `extraResources` because electron-builder
 *    strips node_modules out of extraResources no matter what filter you give
 *    it, and the standalone server carries its own traced node_modules (Next
 *    itself, plus better-sqlite3's native binary). Without them the packaged app
 *    dies at launch with "Cannot find module 'next'".
 *
 * 2. Ad-hoc sign the macOS bundle. Without a paid Developer ID cert,
 *    electron-builder leaves the app carrying the Electron binary's original
 *    *linker* signature, which is INVALID once the bundle is renamed and our
 *    payload is injected — macOS reports that as "…is damaged and can't be
 *    opened". Re-signing ad-hoc (identity "-") produces a valid signature, so
 *    Gatekeeper falls back to the ordinary unsigned-app prompt instead.
 *
 * The copy must happen before the signing, or the signature won't cover it.
 */

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

/* Where a packed app keeps its resources, per platform. */
function resourcesDir(context) {
  if (context.electronPlatformName === 'darwin') {
    const appName = context.packager.appInfo.productFilename; // "Simplicity"
    return path.join(context.appOutDir, `${appName}.app`, 'Contents', 'Resources');
  }
  return path.join(context.appOutDir, 'resources');
}

exports.default = async function afterPack(context) {
  const projectDir = path.join(__dirname, '..');
  const resources = resourcesDir(context);

  for (const rel of [path.join('.next', 'standalone'), 'drizzle']) {
    const from = path.join(projectDir, rel);
    const to = path.join(resources, rel);
    if (!fs.existsSync(from)) {
      throw new Error(`[afterPack] missing ${rel} — run \`yarn build:desktop\` first`);
    }
    fs.rmSync(to, { recursive: true, force: true });
    fs.cpSync(from, to, { recursive: true });
  }

  /* Fail loudly here rather than at the user's first launch. */
  const next = path.join(resources, '.next', 'standalone', 'node_modules', 'next');
  if (!fs.existsSync(next)) {
    throw new Error('[afterPack] standalone node_modules did not make it into the bundle');
  }
  console.log('[afterPack] staged standalone server + migrations');

  if (context.electronPlatformName !== 'darwin') return;

  const appPath = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`,
  );
  console.log(`[afterPack] ad-hoc signing ${appPath}`);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], {
    stdio: 'inherit',
  });
  execFileSync('codesign', ['--verify', '--strict', '--verbose=2', appPath], {
    stdio: 'inherit',
  });
  console.log('[afterPack] signature verified');
};
