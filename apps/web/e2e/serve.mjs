// Starts a Rhizom server for the end-to-end tests on a throwaway copy of the example vault,
// so the tests may create, change and delete notes without touching the repository. A second,
// small vault beside it is what the tests switch to.
import { spawn } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const serverDir = join(repoRoot, 'apps', 'server');
const workspace = mkdtempSync(join(tmpdir(), 'rhizom-e2e-'));
const vaultDir = join(workspace, 'vault');
const dataDir = join(workspace, 'data');

cpSync(join(repoRoot, 'examples', 'vault'), vaultDir, { recursive: true });

const secondDir = join(workspace, 'second');
mkdirSync(secondDir, { recursive: true });
writeFileSync(join(secondDir, 'Thesis.md'), '# Thesis\n\nChapter one links [[Method]].\n');
writeFileSync(join(secondDir, 'Method.md'), '# Method\n');

// A developer's own RHIZOM_VAULT_DIR would collide with the list below and stop the server.
const env = { ...process.env };
delete env['RHIZOM_VAULT_DIR'];

const child = spawn(process.execPath, ['--import', 'tsx', join(serverDir, 'src', 'server.ts')], {
  cwd: serverDir,
  stdio: 'inherit',
  env: {
    ...env,
    RHIZOM_VAULTS: `default=${vaultDir};second=${secondDir}`,
    RHIZOM_DATA_DIR: dataDir,
    HOST: '127.0.0.1',
    PORT: process.env['PORT'] ?? '3737',
    LOG_LEVEL: 'warn',
  },
});

const cleanUp = () => {
  child.kill();
  rmSync(workspace, { recursive: true, force: true });
};

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    cleanUp();
    process.exit(0);
  });
}
process.on('exit', cleanUp);
child.on('exit', (code) => {
  process.exit(code ?? 0);
});
