// Packs a Rhizom you can run without building one: the server with its dependencies, the built
// web app in the place the server looks for it, and the example vault to point it at.
//
// One package serves every operating system. The only native dependency, better-sqlite3, ships a
// prebuilt binary for each platform and picks the right one at startup, so a package assembled on
// a Linux runner starts on Windows and macOS too — as long as Node is one of the versions the
// server's `engines` field allows.
//
// The tree the deploy leaves behind must be flat. pnpm's own layout is a farm of symlinks into a
// virtual store, and an archive does not carry those reliably — a package whose links arrive as
// empty files fails at the first import, on somebody else's machine, after the download. Hence
// `--config.node-linker=hoisted` on the deploy, and the check at the end of this file: no
// symlink leaves here, and the day that stops being true the packaging stops rather than the
// server.
import {
  cpSync,
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'dist', 'package');
const server = join(out, 'server');

/** What `pnpm deploy` copies along with the package and a running server has no use for. */
const UNUSED = [
  'src',
  'data',
  'coverage',
  'tsconfig.json',
  'tsconfig.build.json',
  'tsconfig.test.json',
  'vitest.config.ts',
];

function version() {
  const manifest = JSON.parse(readFileSync(join(root, 'apps', 'server', 'package.json'), 'utf8'));
  return manifest.version;
}

function commit() {
  if (process.env.GITHUB_SHA !== undefined && process.env.GITHUB_SHA !== '') {
    return process.env.GITHUB_SHA.slice(0, 7);
  }
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root }).toString().trim();
  } catch {
    return 'unknown';
  }
}

/** @param {string} directory */
async function totalBytes(directory) {
  let total = 0;
  for (const entry of await readdir(directory, { withFileTypes: true, recursive: true })) {
    if (entry.isFile()) {
      total += statSync(join(entry.parentPath, entry.name)).size;
    }
  }
  return total;
}

/** @param {string} stamp */
const readme = (stamp) => `Rhizom ${stamp}

A self-hostable tool for networked knowledge. This package is a built Rhizom: no compiler, no
package manager, nothing to install but Node.

WHAT YOU NEED
  Node 22.22 or newer (24 is what this was built and tested against).

RUN IT, ON THE EXAMPLE VAULT
  cd server
  RHIZOM_VAULT_DIR=../example-vault node dist/server.js
  ...and open http://localhost:3737

  On Windows, in PowerShell:
  cd server
  $env:RHIZOM_VAULT_DIR = "../example-vault"; node dist/server.js

RUN IT ON YOUR OWN NOTES
  Point RHIZOM_VAULT_DIR at a folder of Markdown files. An Obsidian vault works as it is:
  Rhizom reads the files, it does not convert them, and it writes nothing into them unless you
  ask it to.

WHAT IT WRITES
  An index, under RHIZOM_DATA_DIR (default: ./data next to where you started it). It is derived
  from your notes and can be deleted at any time; it is rebuilt on the next start.

OTHER SETTINGS
  PORT       default 3737
  HOST       default localhost (use 0.0.0.0 to reach it from another machine)
  LOG_LEVEL  default info

THIS IS A 0.x
  The format a vault is written in is still moving, and this package is a build from the main
  branch rather than a release. Keep a backup of your notes.

  https://github.com/lokianer/rhizom
`;

// The server, with its production dependencies resolved into a real node_modules tree.
if (!existsSync(join(server, 'package.json'))) {
  throw new Error('run this through "pnpm run package": it deploys the server first');
}
for (const name of UNUSED) {
  rmSync(join(server, name), { recursive: true, force: true });
}

// Where the server looks for the web app: two levels up from its own dist/, then web/dist.
const web = join(root, 'apps', 'web', 'dist');
if (!existsSync(web)) {
  throw new Error('apps/web/dist is missing — run "pnpm build" first');
}
cpSync(web, join(out, 'web', 'dist'), { recursive: true });

cpSync(join(root, 'examples', 'vault'), join(out, 'example-vault'), { recursive: true });

const stamp = `${version()} (${commit()})`;
writeFileSync(join(out, 'README.txt'), readme(stamp), 'utf8');

// Said out loud, because a package with one link left in it is a package that does not start
// on the other side of an archive.
const links = [];
for (const entry of readdirSync(out, { withFileTypes: true, recursive: true })) {
  if (entry.isSymbolicLink()) {
    links.push(join(entry.parentPath, entry.name));
  }
}
if (links.length > 0) {
  throw new Error(`${String(links.length)} symlinks left in the package, first: ${links[0]}`);
}

const bytes = await totalBytes(out);
console.log(`Package assembled in ${out} — ${(bytes / 1024 / 1024).toFixed(1)} MB, ${stamp}`);
