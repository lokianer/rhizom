// Starts a Rhizom server for the end-to-end tests on a throwaway copy of the example vault,
// so the tests may create, change and delete notes without touching the repository.
import { spawn } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const serverDir = join(repoRoot, 'apps', 'server');
const workspace = mkdtempSync(join(tmpdir(), 'rhizom-e2e-'));
const vaultDir = join(workspace, 'vault');
const dataDir = join(workspace, 'data');

cpSync(join(repoRoot, 'examples', 'vault'), vaultDir, { recursive: true });

const child = spawn(process.execPath, ['--import', 'tsx', join(serverDir, 'src', 'server.ts')], {
  cwd: serverDir,
  stdio: 'inherit',
  env: {
    ...process.env,
    RHIZOM_VAULT_DIR: vaultDir,
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
